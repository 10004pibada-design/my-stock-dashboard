"""
스마트 주식 대시보드 - Flask 백엔드
실시간 주식 데이터 제공 및 기술적 분석 API
"""

from flask import Flask, render_template, jsonify, request, session, redirect, url_for
from flask_cors import CORS
from functools import wraps
import yfinance as yf
import pandas as pd
import numpy as np
import json
import os
from datetime import datetime, timedelta, timezone
from typing import List, Dict
import time
import hmac
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from core_utils import (
    clean_nan_values,
    normalize_ticker,
    is_valid_ticker,
    is_korean_market_ticker,
    convert_to_native,
    calculate_rsi,
    calculate_macd,
    calculate_bollinger_bands,
    analyze_signal,
)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-89780186')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=os.environ.get('FLASK_ENV') == 'production',
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
)
CORS(app, supports_credentials=True)

# 비밀번호 설정
ACCESS_PASSWORD = os.environ.get('ACCESS_PASSWORD', '89780186')
VALID_PERIODS = {'5d', '1mo', '3mo', '6mo', '1y', '2y', '3y', '5y', 'max'}
MAX_CACHE_ENTRIES = 200
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 300
LOCKOUT_SECONDS = 300
MAX_SEARCH_RESULTS = 50


def get_client_ip() -> str:
    """클라이언트 IP 추출"""
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.remote_addr or 'unknown'


def _prune_old_attempts(ip: str, now_ts: float):
    attempts = _login_attempts.get(ip, [])
    attempts = [ts for ts in attempts if now_ts - ts <= LOGIN_WINDOW_SECONDS]
    _login_attempts[ip] = attempts
    return attempts


def parse_positive_float(value, field_name: str):
    """양수 숫자 필드 파싱/검증"""
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ValueError(f'{field_name}는 숫자여야 합니다.')

    if number <= 0:
        raise ValueError(f'{field_name}는 0보다 커야 합니다.')

    return number


def login_required(f):
    """로그인 필요 데코레이터"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('authenticated'):
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated_function


@app.route('/login', methods=['GET', 'POST'])
def login():
    """로그인 페이지"""
    client_ip = get_client_ip()
    now_ts = time.time()
    attempts = _prune_old_attempts(client_ip, now_ts)

    if request.method == 'POST':
        if len(attempts) >= MAX_LOGIN_ATTEMPTS:
            retry_after = int(LOCKOUT_SECONDS - (now_ts - attempts[0]))
            if retry_after > 0:
                return render_template(
                    'login.html',
                    error=f'로그인 시도 횟수를 초과했습니다. {retry_after}초 후 다시 시도해주세요.'
                )

        password = request.form.get('password', '')
        if hmac.compare_digest(password, ACCESS_PASSWORD):
            _login_attempts.pop(client_ip, None)
            session.clear()
            session.permanent = True
            session['authenticated'] = True
            return redirect(url_for('index'))
        else:
            _login_attempts[client_ip].append(now_ts)
            return render_template('login.html', error='비밀번호가 올바르지 않습니다.')
    return render_template('login.html')


@app.route('/logout')
def logout():
    """로그아웃"""
    session.pop('authenticated', None)
    return redirect(url_for('login'))


@app.route('/test')
@login_required
def test_page():
    """테스트 페이지"""
    return render_template('test.html')


@app.route('/api/debug/session')
def debug_session():
    """세션 디버깅 API"""
    if os.environ.get('FLASK_ENV') == 'production':
        return jsonify({'success': False, 'error': 'Not available in production'}), 403

    return jsonify({
        'authenticated': session.get('authenticated', False),
        'session_keys': list(session.keys())
    })


@app.route('/api/health')
def health_check():
    """헬스체크 API"""
    return jsonify({'success': True, 'status': 'ok', 'timestamp': datetime.now(timezone.utc).isoformat()})


# 설정
TICKERS_FILE = 'user_tickers.json'
CACHE_DURATION = 60  # 1분 캐시

# 기본 종목 (시작 시 로드)
DEFAULT_TICKERS = {
    'SK하이닉스': '000660.KS',
    '삼성중공업': '010140.KS',
}

# 메모리 캐시
_cache = {}
_cache_time = {}
_login_attempts = defaultdict(list)


def get_cache(key):
    """캐시된 데이터 확인"""
    if key not in _cache:
        return None

    if time.time() - _cache_time.get(key, 0) >= CACHE_DURATION:
        _cache.pop(key, None)
        _cache_time.pop(key, None)
        return None

    return _cache[key]


def set_cache(key, data):
    """데이터 캐시 저장"""
    _cache[key] = data
    _cache_time[key] = time.time()

    # 캐시 용량 제한: 오래된 항목부터 제거
    if len(_cache) > MAX_CACHE_ENTRIES:
        oldest_key = min(_cache_time, key=_cache_time.get)
        _cache.pop(oldest_key, None)
        _cache_time.pop(oldest_key, None)


def load_user_tickers():
    """사용자 추가 종목 로드"""
    if not os.path.exists(TICKERS_FILE):
        return {}
    try:
        with open(TICKERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def save_user_tickers(tickers):
    """사용자 종목 저장"""
    with open(TICKERS_FILE, 'w', encoding='utf-8') as f:
        json.dump(tickers, f, ensure_ascii=False, indent=2)


def fetch_stock_data(ticker, period='1y'):
    """종목 데이터 수집 및 기술적 분석"""
    cache_key = f"{ticker}_{period}"
    cached = get_cache(cache_key)
    if cached:
        return cached
    
    try:
        df = yf.download(ticker, period=period, progress=False, threads=False, auto_adjust=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        if df.empty:
            return None
        
        # 기본 이동평균선
        df['MA20'] = df['Close'].rolling(window=20).mean()
        df['MA60'] = df['Close'].rolling(window=60).mean()

        # NaN 제거 - MA20이 있는 행부터 사용 (초기 20일은 MA20 없음)
        df_clean = df.dropna(subset=['MA20'])

        # 데이터가 충분한지 확인
        if df_clean.empty:
            print(f"Error: {ticker} - Insufficient data after cleaning")
            return None

        # 데이터 추출
        closes = df_clean['Close'].values.flatten()
        opens = df_clean['Open'].values.flatten()
        lows = df_clean['Low'].values.flatten()
        highs = df_clean['High'].values.flatten()
        volumes = df_clean['Volume'].values.flatten()
        ma20_values = df_clean['MA20'].values.flatten()
        ma60_values = df_clean['MA60'].values.flatten()

        # 기술적 지표 계산 (cleaned 데이터 기준)
        rsi_values = calculate_rsi(closes)
        macd_data = calculate_macd(closes)
        bb_data = calculate_bollinger_bands(closes)
        
        # 데이터 길이 확인
        if len(closes) == 0:
            print(f"Error: {ticker} - No price data available")
            return None
        
        # 최신 값
        latest_price = float(closes[-1])
        latest_vol = int(volumes[-1]) if len(volumes) > 0 else 0
        latest_ma20 = float(ma20_values[-1]) if len(ma20_values) > 0 and not np.isnan(ma20_values[-1]) else latest_price
        latest_ma60 = float(ma60_values[-1]) if len(ma60_values) > 0 and not np.isnan(ma60_values[-1]) else latest_price
        
        # RSI는 이미 cleaned 데이터 길이와 동일하게 계산됨
        rsi_for_analysis = rsi_values
        
        # 시그널 분석
        signal_text, signal_class, signal_reason, reasons = analyze_signal(
            latest_price, latest_ma20, latest_ma60, 
            rsi_for_analysis if len(rsi_for_analysis) > 0 else None
        )
        
        # 등락률 계산
        change_pct = 0
        if len(closes) >= 2 and closes[-2] != 0:
            change_pct = ((closes[-1] - closes[-2]) / closes[-2]) * 100
        
        result = {
            'ticker': ticker,
            'dates': df_clean.index.strftime('%Y-%m-%d').tolist(),
            'kline': [[float(o), float(c), float(l), float(h)]
                     for o, c, l, h in zip(opens, closes, lows, highs)],
            'volumes': convert_to_native(volumes),
            'ma20': convert_to_native(ma20_values),
            'ma60': convert_to_native(ma60_values),
            'rsi': rsi_for_analysis,
            'macd': macd_data,
            'bollinger': bb_data,
            'latest_price': latest_price,
            'latest_vol': latest_vol,
            'change_pct': round(change_pct, 2),
            'signal_text': signal_text,
            'signal_class': signal_class,
            'signal_reason': signal_reason,
            'signal_reasons': reasons,
            'rsi_value': rsi_for_analysis[-1] if len(rsi_for_analysis) > 0 else None,
            'updated_at': datetime.now().isoformat()
        }
        
        set_cache(cache_key, result)
        return result
        
    except Exception as e:
        print(f"Error fetching {ticker}: {e}")
        import traceback
        traceback.print_exc()
        return None


@app.route('/')
@login_required
def index():
    """메인 페이지"""
    return render_template('index.html')


@app.route('/api/stock/<ticker>')
@login_required
def get_stock(ticker):
    """단일 종목 데이터 API"""
    period = request.args.get('period', '1y')
    period = period if period in VALID_PERIODS else '1y'

    ticker = normalize_ticker(ticker)
    if not is_valid_ticker(ticker):
        return jsonify({'success': False, 'error': '유효하지 않은 티커 형식입니다.'}), 400

    data = fetch_stock_data(ticker, period)
    if data:
        return jsonify({'success': True, 'data': clean_nan_values(data)})
    return jsonify({'success': False, 'error': '데이터를 가져올 수 없습니다.'}), 500


@app.route('/api/stocks')
@login_required
def get_all_stocks():
    """모든 관심 종목 데이터 API"""
    period = request.args.get('period', '1y')
    period = period if period in VALID_PERIODS else '1y'

    user_tickers = load_user_tickers()
    user_ticker_names = set(user_tickers.keys())
    all_tickers = {**DEFAULT_TICKERS, **user_tickers}

    results = {}

    def fetch_one(item):
        name, raw_ticker = item
        ticker = normalize_ticker(raw_ticker)
        if not is_valid_ticker(ticker):
            return ticker, None, name
        data = fetch_stock_data(ticker, period)
        return ticker, data, name

    items = list(all_tickers.items())
    if not items:
        return jsonify({'success': True, 'data': {}, 'count': 0})

    max_workers = min(4, len(items))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(fetch_one, item) for item in items]
        for future in as_completed(futures):
            ticker, data, name = future.result()
            if data:
                data['name'] = name
                data['name_key'] = name
                data['is_user_added'] = name in user_ticker_names
                results[ticker] = data

    return jsonify({
        'success': True,
        'data': clean_nan_values(results),
        'count': len(results)
    })


@app.route('/api/search')
@login_required
def search_stocks():
    """주식 검색 API (한국 주식) - 개선된 버전"""
    query = request.args.get('q', '').strip()
    if not query or len(query) < 1:
        return jsonify({'success': False, 'error': '검색어를 입력해주세요.'}), 400

    try:
        limit = int(request.args.get('limit', '10'))
    except ValueError:
        return jsonify({'success': False, 'error': 'limit은 숫자여야 합니다.'}), 400

    if limit <= 0:
        return jsonify({'success': False, 'error': 'limit은 1 이상이어야 합니다.'}), 400

    limit = min(limit, MAX_SEARCH_RESULTS)

    # 개선된 한국 주식 검색
    try:
        results = search_korean_stocks(query, limit=limit)
        
        if not results:
            # Yahoo Finance로 직접 시도
            try:
                stock = yf.Ticker(query)
                info = stock.info
                if info and info.get('symbol'):
                    results.append({
                        'name': info.get('longName') or info.get('shortName') or query,
                        'ticker': query,
                        'market': 'UNKNOWN',
                        'exact': True
                    })
            except:
                pass
        
        return jsonify({'success': True, 'results': results, 'count': len(results)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/tickers', methods=['GET', 'POST', 'DELETE'])
@login_required
def manage_tickers():
    """관심 종목 관리 API"""
    if request.method == 'GET':
        user_tickers = load_user_tickers()
        return jsonify({
            'success': True, 
            'tickers': {**DEFAULT_TICKERS, **user_tickers},
            'user_only': user_tickers
        })
    
    elif request.method == 'POST':
        data = request.get_json(silent=True) or {}
        name = data.get('name', '').strip()
        ticker = normalize_ticker(data.get('ticker', '').strip())

        if not ticker:
            return jsonify({'success': False, 'error': '티커를 입력해주세요.'}), 400

        if not is_valid_ticker(ticker):
            return jsonify({'success': False, 'error': '유효하지 않은 티커 형식입니다.'}), 400

        if not is_korean_market_ticker(ticker):
            return jsonify({'success': False, 'error': '올바른 한국 주식 코드 형식이 아닙니다. (예: 005930.KS)'}), 400

        # 데이터 유효성 검사
        test_data = fetch_stock_data(ticker, period='5d')
        if not test_data:
            return jsonify({'success': False, 'error': '해당 종목의 데이터를 가져올 수 없습니다. 코드를 확인해주세요.'}), 400

        # 종목명 미입력 시 종목코드 기반으로 회사명 자동 매핑
        if not name:
            name = resolve_stock_display_name(ticker)

        user_tickers = load_user_tickers()
        all_tickers = {**DEFAULT_TICKERS, **user_tickers}

        if ticker in all_tickers.values():
            return jsonify({'success': False, 'error': '이미 메인 종목에 추가된 티커입니다.'}), 409

        user_tickers[name] = ticker
        save_user_tickers(user_tickers)

        return jsonify({
            'success': True,
            'message': f'{name}({ticker})가 추가되었습니다.',
            'ticker': ticker,
            'name': name,
            'data': test_data
        })
    
    elif request.method == 'DELETE':
        data = request.get_json(silent=True) or {}
        name = data.get('name', '').strip()
        
        user_tickers = load_user_tickers()
        if name in user_tickers:
            del user_tickers[name]
            save_user_tickers(user_tickers)
            return jsonify({'success': True, 'message': f'{name}가 삭제되었습니다.'})
        return jsonify({'success': False, 'error': '해당 종목을 찾을 수 없습니다.'}), 404


@app.route('/api/market-status')
@login_required
def market_status():
    """시장 상태 확인 API"""
    now_utc = datetime.now(timezone.utc)
    now_kst = now_utc.astimezone(timezone(timedelta(hours=9)))

    # 한국 장 시간: 09:00 ~ 15:30 (월~금)
    is_weekday = now_kst.weekday() < 5
    is_open = is_weekday and (
        9 <= now_kst.hour < 15 or (now_kst.hour == 15 and now_kst.minute <= 30)
    )

    return jsonify({
        'success': True,
        'is_market_open': is_open,
        'is_open': is_open,  # 프론트 호환성
        'current_time_utc': now_utc.isoformat(),
        'korean_time': now_kst.isoformat()
    })


# ========================================
# 포트폴리오 API (Portfolio) - SQLite 버전
# ========================================
from portfolio_db import portfolio_manager

# ========================================
# 주식 검색 데이터베이스 (이름으로 검색 가능)
# ========================================
KOREAN_STOCKS = {
    # 코스피 대형주
    '삼성전자': '005930.KS', 'SK하이닉스': '000660.KS', '현대차': '005380.KS',
    '삼성전자우': '005935.KS', '기아': '000270.KS', 'LG에너지솔루션': '373220.KS',
    '현대모비스': '012330.KS', '삼성SDI': '006400.KS', 'NAVER': '035420.KS',
    '카카오': '035720.KS', 'LG화학': '051910.KS', '삼성바이오로직스': '207940.KS',
    'POSCO홀딩스': '005490.KS', 'KB금융': '105560.KS', '현대중공업': '009540.KS',
    '신한지주': '055550.KS', '삼성생명': '032830.KS', '하나금융지주': '086790.KS',
    '하이브': '352820.KS', 'LG전자': '066570.KS', '삼성중공업': '010140.KS',
    '한국전력': '015760.KS', '삼성물산': '028260.KS', '기업은행': '024110.KS',
    'KT&G': '033780.KS', '현대건설': '000720.KS', '대우조선해양': '042660.KS',
    'CJ대한통운': '000120.KS', '오뚜기': '007310.KS', '농심': '004370.KS',
    '한화에어로스페이스': '012450.KS', '롯데케미칼': '011170.KS', 'S-Oil': '010950.KS',
    'GS리테일': '007070.KS', '이마트': '139480.KS', '신세계': '004170.KS',
    '현대백화점': '069960.KS', '강원랜드': '035250.KS', '코웨이': '021240.KS',
    '삼성엔지니어링': '028050.KS', '대림건설': '000210.KS', 'DL이앤씨': '375500.KS',
    'HMM': '011200.KS', '대한항공': '003490.KS', '아시아나항공': '020560.KS',
    '제주항공': '089590.KS', '에어프레미아': '089300.KS', 'LX인터내셔널': '001120.KS',
    'LX하우시스': '108670.KS', 'LG유플러스': '032640.KS', 'SK텔레콤': '017670.KS',
    'KT': '030200.KS', 'CJ': '001040.KS', 'CJENM': '035760.KS',
    'CJ제일제당': '097950.KS', '오리온': '271560.KS', '롯데지주': '004990.KS',
    '두산에너빌리티': '034020.KS', '두산밥캣': '241560.KS', '효성': '004800.KS',
    '효성첨단소재': '298050.KS', 'SK': '034730.KS', 'GS': '078930.KS',
    '한화': '000880.KS', '금호석유': '011780.KS', '코오롱인더': '120110.KS',
    '넥센타이어': '002350.KS', '한국타이어': '161390.KS', 'LG디스플레이': '034220.KS',
    '삼성디스플레이': 'undefined.KS', 'DBX': '078860.KS', '에스엘': '005850.KS',
    '만도': '204320.KS', '현대위아': '011210.KS', '현대제철': '004020.KS',
    '동국제강': '001230.KS', '현대미포조선': '010620.KS', '삼성重': '010140.KS',
    '한화오션': '042660.KS', '대우조선': '042660.KS', '포스코인터내셔널': '047050.KS',
    '현대글로비스': '001250.KS', '쿠팡': 'CPNG', '우한': 'undefined',
    # KOSDAQ
    '카카오게임즈': '293490.KQ', '엔씨소프트': '036570.KQ', '네오위즈': '095660.KQ',
    '넷마블': '251270.KQ', '위메이드': '112040.KQ', 'NHN': '181710.KQ',
    '컴투스': '078340.KQ', '펄어비스': '263750.KQ', '더블유게임즈': '192080.KQ',
    '위메이드맥스': '101730.KQ', '한빛소프트': '047080.KQ', '게임빌': '063080.KQ',
    '스마일게이트': 'undefined', '카카오페이': '377300.KQ', '토스': 'undefined',
    '네이버페이': 'undefined', '배달의민족': 'undefined', '쏘카': 'undefined',
    '야놀자': 'undefined', '직방': 'undefined', '두나무': 'undefined',
    '빗썸': 'undefined', '코인원': 'undefined', '코빗': 'undefined',
    '셀트리온헬스케어': '091990.KQ', '셀트리온제약': '068760.KQ', '알테오젠': '196170.KQ',
    '바이오노트': '376090.KQ', '레고켐바이오': '141080.KQ', '신풍제약': '019170.KQ',
    '종근당': '185750.KQ', '종근당바이오': '001630.KQ', '한미약품': '128940.KQ',
    '일동제약': '249420.KQ', '유한양행': '000100.KS', '대웅제약': '069620.KQ',
    '녹십자': '006280.KS', '메디톡스': '086900.KQ', '휴젤': '145020.KQ',
    '에이스토리': '241840.KQ', '스튜디오드래곤': '253450.KQ', '씨제이': '000120.KS',
    'JYP': '035900.KQ', 'SM': '041510.KQ', 'YG': '122870.KQ',
    '하이브': '352820.KQ', '스타쉽': 'undefined', '큐브': '182360.KQ',
    'FNC': '173940.KQ', ' 팬엔터': 'undefined', '클라씨': 'undefined',
    '에스파': 'undefined', '뉴진스': 'undefined', '블랙핑크': 'undefined',
    '아이브': 'undefined', '세븐틴': 'undefined', 'BTS': 'undefined',
    '방탄소년단': 'undefined', '엑소': 'undefined', '엔시티': 'undefined',
    '에스엠': '041510.KQ', '와이지': '122870.KQ', '제와이피': '035900.KQ',
    '펄어비스': '263750.KQ', '스타일리스트': '336060.KQ', '애드테크': 'undefined',
    '크래프톤': '259960.KQ', '스마일게이트': 'undefined', '넥슨': 'undefined',
    '한게임': '174790.KQ', '게임빌': '063080.KQ', '컴투스홀딩스': '063080.KQ'
}

def resolve_stock_display_name(ticker: str) -> str:
    """티커 기반 종목명 자동 매핑 (로컬 DB 우선, Yahoo Finance 보조)"""
    normalized = normalize_ticker(ticker)

    # 1) 내장 한국 종목 DB 우선 사용
    for stock_name, stock_ticker in KOREAN_STOCKS.items():
        if normalize_ticker(stock_ticker) == normalized and 'undefined' not in stock_ticker.lower():
            return stock_name.strip()

    # 2) Yahoo Finance 메타정보 사용 (가능한 경우)
    try:
        info = yf.Ticker(normalized).info
        yf_name = (info.get('longName') or info.get('shortName') or '').strip() if info else ''
        if yf_name:
            return yf_name
    except Exception:
        pass

    # 3) 최종 fallback
    return normalized


def search_korean_stocks(query: str, limit: int = 10) -> List[Dict]:
    """주식 이름으로 검색"""
    query = query.lower().strip()
    results = []

    def is_listable_ticker(ticker: str) -> bool:
        if not ticker:
            return False
        t = ticker.strip().upper()
        return 'UNDEFINED' not in t and t != 'N/A'

    # 정확한 매칭 먼저
    for name, ticker in KOREAN_STOCKS.items():
        if query in name.lower() and is_listable_ticker(ticker):
            results.append({
                'name': name,
                'ticker': ticker,
                'market': 'KOSPI' if '.KS' in ticker else 'KOSDAQ' if '.KQ' in ticker else 'ETC',
                'exact': query == name.lower()
            })

    # Yahoo Finance에서 추가 검증 (선택사항)
    if len(results) < 5:
        try:
            # 티커로 직접 검색 시도
            if query.isdigit():
                if len(query) == 6:
                    # 6자리 숫자는 한국 주식 코드
                    tickers = [f"{query}.KS", f"{query}.KQ"]
                else:
                    tickers = [query]

                for t in tickers:
                    try:
                        stock = yf.Ticker(t)
                        info = stock.info
                        if info and info.get('symbol'):
                            name = info.get('longName') or info.get('shortName') or t
                            results.append({
                                'name': name,
                                'ticker': t,
                                'market': 'KOSPI' if t.endswith('.KS') else 'KOSDAQ' if t.endswith('.KQ') else 'OTHER',
                                'exact': False
                            })
                    except Exception:
                        pass
        except Exception:
            pass

    # 중복 제거 (티커 기준) + 정확 매칭 우선 정렬
    dedup = {}
    for item in results:
        key = item['ticker'].upper()
        if key not in dedup or item.get('exact'):
            dedup[key] = item

    sorted_results = sorted(dedup.values(), key=lambda x: (not x['exact'], x['name']))
    return sorted_results[:limit]  # 요청 수만큼 결과 반환

@app.route('/api/portfolio', methods=['GET', 'POST'])
@login_required
def portfolio_api():
    """포트폴리오 API"""
    if request.method == 'GET':
        # 포트폴리오 데이터 반환
        returns = portfolio_manager.calculate_returns()
        return jsonify({
            'success': True,
            'data': returns
        })
    
    elif request.method == 'POST':
        # 새 보유 종목 추가
        data = request.get_json(silent=True) or {}
        ticker = normalize_ticker(data.get('ticker', '').strip())
        name = data.get('name', '').strip()
        purchase_date = data.get('purchase_date')

        try:
            shares = parse_positive_float(data.get('shares'), 'shares')
            avg_price = parse_positive_float(data.get('avg_price'), 'avg_price')
        except ValueError as e:
            return jsonify({'success': False, 'error': str(e)}), 400

        if not ticker or not name:
            return jsonify({'success': False, 'error': '모든 필드를 올바르게 입력해주세요.'}), 400

        if not is_valid_ticker(ticker):
            return jsonify({'success': False, 'error': '유효하지 않은 티커 형식입니다.'}), 400

        holding = portfolio_manager.add_holding(ticker, name, shares, avg_price, purchase_date)
        return jsonify({
            'success': True,
            'message': f'{name}({ticker})가 추가되었습니다.',
            'holding': holding
        })


@app.route('/api/portfolio/<holding_id>', methods=['DELETE', 'PUT'])
@login_required
def portfolio_holding_api(holding_id):
    """개별 보유 종목 관리 API"""
    if request.method == 'DELETE':
        # 보유 종목 삭제
        success = portfolio_manager.remove_holding(holding_id)
        if success:
            return jsonify({'success': True, 'message': '종목이 삭제되었습니다.'})
        return jsonify({'success': False, 'error': '해당 종목을 찾을 수 없습니다.'}), 404
    
    elif request.method == 'PUT':
        # 보유 종목 수정
        data = request.get_json(silent=True) or {}
        field = data.get('field')  # 'shares' 또는 'avg_price'

        try:
            value = parse_positive_float(data.get('value'), field or 'value')
        except ValueError as e:
            return jsonify({'success': False, 'error': str(e)}), 400

        if field == 'shares':
            result = portfolio_manager.update_shares(holding_id, value)
        elif field == 'avg_price':
            result = portfolio_manager.update_avg_price(holding_id, value)
        else:
            return jsonify({'success': False, 'error': '잘못된 필드입니다.'}), 400
        
        if result:
            return jsonify({'success': True, 'message': '수정되었습니다.', 'holding': result})
        return jsonify({'success': False, 'error': '해당 종목을 찾을 수 없습니다.'}), 404


# ========================================
# 백테스팅 API (Backtest)
# ========================================
from backtest import run_backtest

@app.route('/api/backtest/<ticker>')
@login_required
def backtest_api(ticker):
    """백테스팅 API"""
    period = request.args.get('period', '1y')
    period = period if period in {'6m', '1y', '2y', '3y'} else '1y'

    ticker = normalize_ticker(ticker)
    if not is_valid_ticker(ticker):
        return jsonify({'success': False, 'error': '유효하지 않은 티커 형식입니다.'}), 400

    result = run_backtest(ticker, period)
    return jsonify(result)


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
