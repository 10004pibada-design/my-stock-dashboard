"""
WebSocket 실시간 시세 서버
Flask-SocketIO를 사용한 실시간 주식 데이터 스트리밍
"""

from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import yfinance as yf
import pandas as pd
import numpy as np
import json
import os
import threading
import time
from datetime import datetime, timedelta
from functools import lru_cache
import queue

# 포트폴리오 모듈 임포트
from portfolio import portfolio_manager

# 백테스팅 모듈 임포트
from backtest import run_backtest, BacktestEngine

# 설정
TICKERS_FILE = 'user_tickers.json'
CACHE_DURATION = 60  # 1분 캐시

# 기본 종목
DEFAULT_TICKERS = {
    'SK하이닉스': '000660.KS',
    '삼성중공업': '010140.KS',
}

# 메모리 캐시
_cache = {}
_cache_time = {}


def clean_nan_values(obj):
    """재귀적으로 NaN/Infinity 값을 None으로 변환"""
    if isinstance(obj, float):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return obj
    elif isinstance(obj, list):
        return [clean_nan_values(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: clean_nan_values(v) for k, v in obj.items()}
    return obj


def get_cache(key):
    """캐시된 데이터 확인"""
    if key in _cache and time.time() - _cache_time.get(key, 0) < CACHE_DURATION:
        return _cache[key]
    return None


def set_cache(key, data):
    """데이터 캐시 저장"""
    _cache[key] = data
    _cache_time[key] = time.time()


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


def convert_to_native(obj):
    """NumPy/Pandas 객체를 Python 네이티브 타입으로 변환"""
    if isinstance(obj, (np.integer, np.int64, np.int32)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float64, np.float32)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, pd.Series):
        return obj.tolist()
    elif isinstance(obj, list):
        return [convert_to_native(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: convert_to_native(v) for k, v in obj.items()}
    return obj


def calculate_rsi(prices, period=14):
    """RSI (Relative Strength Index) 계산"""
    deltas = np.diff(prices)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)
    
    avg_gains = np.convolve(gains, np.ones(period)/period, mode='valid')
    avg_losses = np.convolve(losses, np.ones(period)/period, mode='valid')
    
    rs = avg_gains / (avg_losses + 1e-10)
    rsi = 100 - (100 / (1 + rs))
    return rsi.tolist()


def calculate_macd(prices, fast=12, slow=26, signal=9):
    """MACD (Moving Average Convergence Divergence) 계산"""
    ema_fast = pd.Series(prices).ewm(span=fast, adjust=False).mean()
    ema_slow = pd.Series(prices).ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line
    
    return {
        'macd': macd_line.tolist(),
        'signal': signal_line.tolist(),
        'histogram': histogram.tolist()
    }


def calculate_bollinger_bands(prices, period=20, std_dev=2):
    """볼린저 밴드 계산"""
    sma = pd.Series(prices).rolling(window=period).mean()
    std = pd.Series(prices).rolling(window=period).std()
    upper = sma + (std * std_dev)
    lower = sma - (std * std_dev)
    
    return {
        'upper': upper.tolist(),
        'middle': sma.tolist(),
        'lower': lower.tolist()
    }


def analyze_signal(latest_close, ma20, ma60, rsi=None):
    """종합 매매 시그널 분석"""
    if pd.isna(ma20) or pd.isna(ma60):
        return "데이터 부족", "hold", "추세 데이터가 부족합니다.", []
    
    reasons = []
    
    # 이동평균선 분석
    if latest_close > ma20 and ma20 > ma60:
        signal = "🔥 강력 보유 (HOLD)"
        signal_class = "hold"
        signal_type = "hold"
        reasons.append("완벽한 정배열 강세장")
    elif latest_close < ma20 and ma20 < ma60:
        signal = "❄️ 비중 축소 (SELL)"
        signal_class = "sell"
        signal_type = "sell"
        reasons.append("역배열 하락 추세")
    elif latest_close > ma20 and ma20 < ma60:
        signal = "💡 단기 반등 (WATCH)"
        signal_class = "buy"
        signal_type = "buy"
        reasons.append("장기 추세 하락 중 단기 회복")
    elif latest_close < ma20 and ma20 > ma60:
        signal = "⚠️ 단기 이탈 주의 (CAUTION)"
        signal_class = "sell"
        signal_type = "caution"
        reasons.append("장기 추세 양호하나 단기 이탈")
    else:
        signal = "⚖️ 횡보 (NEUTRAL)"
        signal_class = "hold"
        signal_type = "neutral"
        reasons.append("뚜렷한 추세 없음")
    
    # RSI 기반 분석
    if rsi is not None and len(rsi) > 0:
        latest_rsi = rsi[-1]
        if latest_rsi > 70:
            reasons.append(f"RSI 과매수 구간 ({latest_rsi:.1f})")
            if signal_type in ["hold", "buy"]:
                signal = "⚠️ 과매수 주의"
                signal_class = "caution"
        elif latest_rsi < 30:
            reasons.append(f"RSI 과매도 구간 ({latest_rsi:.1f})")
            if signal_type in ["sell", "caution"]:
                signal = "💡 과매도 반등 가능"
                signal_class = "buy"
    
    reason_text = f"주가({latest_close:,.0f}원). " + " | ".join(reasons)
    
    return signal, signal_class, reason_text, reasons


def fetch_stock_data(ticker, period='1y'):
    """종목 데이터 수집 및 기술적 분석"""
    cache_key = f"{ticker}_{period}_{datetime.now().strftime('%Y%m%d%H%M')}"
    cached = get_cache(cache_key)
    if cached:
        return cached
    
    try:
        df = yf.download(ticker, period=period, progress=False)
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        if df.empty:
            return None
        
        # 기본 이동평균선
        df['MA20'] = df['Close'].rolling(window=20).mean()
        df['MA60'] = df['Close'].rolling(window=60).mean()
        
        # RSI 계산
        rsi_values = calculate_rsi(df['Close'].values.flatten())
        
        # MACD 계산
        macd_data = calculate_macd(df['Close'].values.flatten())
        
        # 볼린저 밴드
        bb_data = calculate_bollinger_bands(df['Close'].values.flatten())
        
        # NaN 제거
        df = df.dropna()
        
        # 데이터 추출
        closes = df['Close'].values.flatten()
        opens = df['Open'].values.flatten()
        lows = df['Low'].values.flatten()
        highs = df['High'].values.flatten()
        volumes = df['Volume'].values.flatten()
        ma20_values = df['MA20'].values.flatten()
        ma60_values = df['MA60'].values.flatten()
        
        # 최신 값
        latest_price = float(closes[-1])
        latest_vol = int(volumes[-1])
        latest_ma20 = float(ma20_values[-1])
        latest_ma60 = float(ma60_values[-1])
        
        # RSI (데이터 길이 맞춤)
        rsi_for_analysis = rsi_values[-len(closes):] if len(rsi_values) >= len(closes) else rsi_values
        
        # 시그널 분석
        signal_text, signal_class, signal_reason, reasons = analyze_signal(
            latest_price, latest_ma20, latest_ma60, 
            rsi_for_analysis if len(rsi_for_analysis) > 0 else None
        )
        
        # 등락률 계산
        change_pct = 0
        if len(closes) >= 2:
            change_pct = ((closes[-1] - closes[-2]) / closes[-2]) * 100
        
        result = {
            'ticker': ticker,
            'dates': df.index.strftime('%Y-%m-%d').tolist(),
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


def fetch_realtime_quote(ticker):
    """실시간 시세 데이터만 가져오기 (경량)"""
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
        # 현재가 정보
        current_price = info.get('regularMarketPrice') or info.get('currentPrice')
        previous_close = info.get('regularMarketPreviousClose') or info.get('previousClose')
        
        if current_price and previous_close:
            change_pct = ((current_price - previous_close) / previous_close) * 100
        else:
            change_pct = 0
            
        return {
            'ticker': ticker,
            'price': current_price,
            'change_pct': round(change_pct, 2),
            'volume': info.get('regularMarketVolume') or info.get('volume', 0),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        print(f"Error fetching realtime quote for {ticker}: {e}")
        return None


# Flask 앱 및 SocketIO 설정
app = Flask(__name__)
app.config['SECRET_KEY'] = 'stock-dashboard-secret-key'
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='threading')

# 실시간 데이터 스트리밍 스레드
stream_thread = None
stream_stop_event = threading.Event()


class RealtimeStreamer:
    """실시간 시세 스트리밍 관리자"""
    
    def __init__(self):
        self.subscribed_tickers = set()
        self.last_prices = {}
        self.running = False
        
    def add_ticker(self, ticker):
        """종목 구독 추가"""
        self.subscribed_tickers.add(ticker)
        print(f"[WebSocket] Subscribed to {ticker}")
        
    def remove_ticker(self, ticker):
        """종목 구독 제거"""
        if ticker in self.subscribed_tickers:
            self.subscribed_tickers.discard(ticker)
            print(f"[WebSocket] Unsubscribed from {ticker}")
            
    def get_all_tickers(self):
        """모든 활성화된 종목 가져오기"""
        user_tickers = load_user_tickers()
        all_tickers = set(DEFAULT_TICKERS.values()) | set(user_tickers.values())
        return all_tickers
        
    def stream_loop(self):
        """실시간 스트리밍 루프"""
        self.running = True
        print("[WebSocket] Realtime streaming started")
        
        while not stream_stop_event.is_set() and self.running:
            try:
                # 모든 구독된 종목에 대해 데이터 가져오기
                tickers_to_stream = self.get_all_tickers() | self.subscribed_tickers
                
                for ticker in tickers_to_stream:
                    if stream_stop_event.is_set():
                        break
                        
                    quote = fetch_realtime_quote(ticker)
                    if quote:
                        # 가격 변화가 있을 때만 전송
                        last_price = self.last_prices.get(ticker)
                        if last_price != quote['price']:
                            self.last_prices[ticker] = quote['price']
                            
                            # SocketIO로 브로드캐스트
                            socketio.emit('price_update', {
                                'ticker': ticker,
                                'price': quote['price'],
                                'change_pct': quote['change_pct'],
                                'volume': quote['volume'],
                                'timestamp': quote['timestamp']
                            }, namespace='/')
                            
                            print(f"[WebSocket] Broadcast {ticker}: {quote['price']:,.0f} ({quote['change_pct']:+.2f}%)")
                    
                    time.sleep(0.5)  # 각 종목당 0.5초 간격
                    
                # 전체 종목 한 바퀴 돌면 5초 대기
                time.sleep(5)
                
            except Exception as e:
                print(f"[WebSocket] Stream error: {e}")
                time.sleep(5)
                
        print("[WebSocket] Realtime streaming stopped")
        
    def stop(self):
        """스트리밍 중지"""
        self.running = False


# 전역 스트리머 인스턴스
streamer = RealtimeStreamer()


def start_streaming():
    """실시간 스트리밍 스레드 시작"""
    global stream_thread, stream_stop_event
    
    if stream_thread is None or not stream_thread.is_alive():
        stream_stop_event.clear()
        stream_thread = threading.Thread(target=streamer.stream_loop, daemon=True)
        stream_thread.start()
        print("[WebSocket] Streaming thread started")


@app.route('/')
def index():
    """메인 페이지"""
    return render_template('index.html')


@app.route('/api/stock/<ticker>')
def get_stock(ticker):
    """단일 종목 데이터 API"""
    period = request.args.get('period', '1y')
    data = fetch_stock_data(ticker, period)
    if data:
        return jsonify({'success': True, 'data': clean_nan_values(data)})
    return jsonify({'success': False, 'error': '데이터를 가져올 수 없습니다.'}), 500


@app.route('/api/stocks')
def get_all_stocks():
    """모든 관심 종목 데이터 API"""
    user_tickers = load_user_tickers()
    all_tickers = {**DEFAULT_TICKERS, **user_tickers}
    
    results = {}
    for name, ticker in all_tickers.items():
        data = fetch_stock_data(ticker)
        if data:
            data['name'] = name
            results[ticker] = data
    
    return jsonify({
        'success': True, 
        'data': clean_nan_values(results),
        'count': len(results)
    })


@app.route('/api/search')
def search_stocks():
    """주식 검색 API (한국 주식)"""
    query = request.args.get('q', '').strip()
    if not query or len(query) < 2:
        return jsonify({'success': False, 'error': '검색어는 2글자 이상 입력해주세요.'}), 400
    
    try:
        if query.isdigit() and len(query) == 6:
            tickers_to_try = [f"{query}.KS", f"{query}.KQ"]
        else:
            tickers_to_try = [query]
        
        results = []
        for t in tickers_to_try:
            try:
                stock = yf.Ticker(t)
                info = stock.info
                if info and 'symbol' in info:
                    results.append({
                        'ticker': t,
                        'name': info.get('longName', info.get('shortName', t)),
                        'market': 'KOSPI' if t.endswith('.KS') else 'KOSDAQ' if t.endswith('.KQ') else 'Unknown'
                    })
            except Exception:
                continue
        
        return jsonify({'success': True, 'results': results})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/tickers', methods=['GET', 'POST', 'DELETE'])
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
        data = request.get_json()
        name = data.get('name', '').strip()
        ticker = data.get('ticker', '').strip()
        
        if not name or not ticker:
            return jsonify({'success': False, 'error': '종목명과 티커를 모두 입력해주세요.'}), 400
        
        if ticker.isdigit() and len(ticker) == 6:
            ticker = f"{ticker}.KS"
        
        if not (ticker.endswith('.KS') or ticker.endswith('.KQ')):
            return jsonify({'success': False, 'error': '올바른 한국 주식 코드 형식이 아닙니다.'}), 400
        
        test_data = fetch_stock_data(ticker, period='5d')
        if not test_data:
            return jsonify({'success': False, 'error': '해당 종목의 데이터를 가져올 수 없습니다.'}), 400
        
        user_tickers = load_user_tickers()
        user_tickers[name] = ticker
        save_user_tickers(user_tickers)
        
        # 새 종목을 실시간 스트리밍에 추가
        streamer.add_ticker(ticker)
        
        return jsonify({
            'success': True, 
            'message': f'{name}({ticker})가 추가되었습니다.',
            'ticker': ticker,
            'data': test_data
        })
    
    elif request.method == 'DELETE':
        data = request.get_json()
        name = data.get('name', '').strip()
        
        user_tickers = load_user_tickers()
        if name in user_tickers:
            ticker = user_tickers[name]
            del user_tickers[name]
            save_user_tickers(user_tickers)
            streamer.remove_ticker(ticker)
            return jsonify({'success': True, 'message': f'{name}가 삭제되었습니다.'})
        return jsonify({'success': False, 'error': '해당 종목을 찾을 수 없습니다.'}), 404


@app.route('/api/market-status')
def market_status():
    """시장 상태 확인 API"""
    now = datetime.now()
    korean_hour = (now.hour + 9) % 24
    
    is_open = 9 <= korean_hour < 15 or (korean_hour == 15 and now.minute <= 30)
    
    return jsonify({
        'success': True,
        'is_market_open': is_open,
        'current_time': now.isoformat(),
        'korean_time': f"{korean_hour:02d}:{now.minute:02d}"
    })


# ==================== WebSocket 이벤트 핸들러 ====================

@socketio.on('connect')
def handle_connect():
    """클라이언트 연결 처리"""
    print(f'[WebSocket] Client connected: {request.sid}')
    emit('connected', {'message': 'Connected to realtime stock feed', 'sid': request.sid})
    
    # 기존 종목들을 스트리밍에 추가
    all_tickers = streamer.get_all_tickers()
    for ticker in all_tickers:
        streamer.add_ticker(ticker)


@socketio.on('disconnect')
def handle_disconnect():
    """클라이언트 연결 해제 처리"""
    print(f'[WebSocket] Client disconnected: {request.sid}')


@socketio.on('subscribe')
def handle_subscribe(data):
    """특정 종목 구독"""
    ticker = data.get('ticker')
    if ticker:
        streamer.add_ticker(ticker)
        emit('subscribed', {'ticker': ticker, 'message': f'Subscribed to {ticker}'})


@socketio.on('unsubscribe')
def handle_unsubscribe(data):
    """특정 종목 구독 취소"""
    ticker = data.get('ticker')
    if ticker:
        streamer.remove_ticker(ticker)
        emit('unsubscribed', {'ticker': ticker, 'message': f'Unsubscribed from {ticker}'})


@socketio.on('get_quote')
def handle_get_quote(data):
    """실시간 시세 요청 (on-demand)"""
    ticker = data.get('ticker')
    if ticker:
        quote = fetch_realtime_quote(ticker)
        if quote:
            emit('quote_response', {
                'ticker': ticker,
                'data': quote
            })
        else:
            emit('error', {'message': f'Failed to fetch quote for {ticker}'})


@socketio.on('broadcast_request')
def handle_broadcast_request(data):
    """관리자용: 모든 클라이언트에 브로드캐스트"""
    message = data.get('message', '')
    socketio.emit('broadcast', {'message': message})


# ==================== 포트폴리오 API 엔드포인트 ====================

@app.route('/api/portfolio', methods=['GET', 'POST'])
def portfolio_api():
    """포트폴리오 조회 및 추가"""
    if request.method == 'GET':
        # 수익률 계산 포함하여 반환
        result = portfolio_manager.calculate_returns()
        return jsonify({'success': True, 'data': result})
    
    elif request.method == 'POST':
        data = request.get_json()
        ticker = data.get('ticker', '').strip()
        name = data.get('name', '').strip()
        shares = float(data.get('shares', 0))
        avg_price = float(data.get('avg_price', 0))
        
        if not ticker or not name or shares <= 0 or avg_price <= 0:
            return jsonify({'success': False, 'error': '모든 필드를 올바르게 입력해주세요.'}), 400
        
        holding = portfolio_manager.add_holding(ticker, name, shares, avg_price)
        return jsonify({
            'success': True, 
            'message': f'{name} {shares}주가 포트폴리오에 추가되었습니다.',
            'holding': holding
        })


@app.route('/api/portfolio/<holding_id>', methods=['PUT', 'DELETE'])
def portfolio_item_api(holding_id):
    """포트폴리오 개별 종목 수정 및 삭제"""
    if request.method == 'PUT':
        data = request.get_json()
        updates = {}
        
        if 'shares' in data:
            updates['shares'] = float(data['shares'])
        if 'avg_price' in data:
            updates['avg_price'] = float(data['avg_price'])
        
        if 'shares' in updates:
            holding = portfolio_manager.update_shares(holding_id, updates['shares'])
        elif 'avg_price' in updates:
            holding = portfolio_manager.update_avg_price(holding_id, updates['avg_price'])
        else:
            return jsonify({'success': False, 'error': '수정할 항목을 지정해주세요.'}), 400
        
        if holding:
            return jsonify({'success': True, 'holding': holding})
        return jsonify({'success': False, 'error': '해당 종목을 찾을 수 없습니다.'}), 404
    
    elif request.method == 'DELETE':
        if portfolio_manager.remove_holding(holding_id):
            return jsonify({'success': True, 'message': '종목이 삭제되었습니다.'})
        return jsonify({'success': False, 'error': '해당 종목을 찾을 수 없습니다.'}), 404


@app.route('/api/portfolio/history')
def portfolio_history():
    """거래 히스토리 조회"""
    limit = request.args.get('limit', 50, type=int)
    history = portfolio_manager.get_transaction_history(limit)
    return jsonify({'success': True, 'history': history})


@app.route('/api/portfolio/summary')
def portfolio_summary():
    """포트폴리오 요약 정보"""
    result = portfolio_manager.calculate_returns()
    return jsonify({
        'success': True,
        'summary': result['summary'],
        'last_updated': result['last_updated']
    })


# ==================== 백테스팅 API 엔드포인트 ====================

@app.route('/api/backtest/<ticker>')
def backtest_api(ticker):
    """백테스팅 실행 API"""
    period = request.args.get('period', '1y')
    
    # 유효한 기간 검증
    valid_periods = ['6m', '1y', '2y', '3y']
    if period not in valid_periods:
        return jsonify({'success': False, 'error': f'유효하지 않은 기간입니다. 선택: {", ".join(valid_periods)}'}), 400
    
    result = run_backtest(ticker, period)
    return jsonify(result)


@app.route('/api/backtest/signals/<ticker>')
def backtest_signals(ticker):
    """과거 매매 신호 분석 API"""
    period = request.args.get('period', '1y')
    
    try:
        end_date = datetime.now()
        if period == '6m':
            start_date = end_date - timedelta(days=180)
        elif period == '1y':
            start_date = end_date - timedelta(days=365)
        elif period == '2y':
            start_date = end_date - timedelta(days=730)
        else:
            start_date = end_date - timedelta(days=365)
        
        # 백테스트 엔진으로 데이터 분석
        engine = BacktestEngine()
        df = yf.download(ticker, start=start_date, end=end_date, progress=False)
        
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.droplevel(1)
        
        if df.empty:
            return jsonify({'success': False, 'error': '데이터를 가져올 수 없습니다.'}), 500
        
        df = engine.calculate_indicators(df)
        df = engine.generate_signals(df)
        
        # 신호 발생일만 추출
        signals = []
        for i in range(len(df)):
            if df['Signal'].iloc[i] != 'hold':
                signals.append({
                    'date': df.index[i].strftime('%Y-%m-%d'),
                    'signal': df['Signal'].iloc[i],
                    'price': float(df['Close'].iloc[i]),
                    'rsi': float(df['RSI'].iloc[i]) if not pd.isna(df['RSI'].iloc[i]) else None,
                    'ma20': float(df['MA20'].iloc[i]) if not pd.isna(df['MA20'].iloc[i]) else None,
                    'ma60': float(df['MA60'].iloc[i]) if not pd.isna(df['MA60'].iloc[i]) else None
                })
        
        return jsonify({
            'success': True,
            'ticker': ticker,
            'period': period,
            'signal_count': len(signals),
            'signals': signals[:50]  # 최근 50개 신호만 반환
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


if __name__ == '__main__':
    # 실시간 스트리밍 스레드 시작
    start_streaming()
    
    # SocketIO 서버 실행 (WebSocket 지원)
    socketio.run(app, debug=True, host='0.0.0.0', port=5000, allow_unsafe_werkzeug=True)
