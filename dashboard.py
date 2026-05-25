import yfinance as yf
import pandas as pd
import json
import os
import numpy as np

# ─────────────────────────────────────────────
# 기본 고정 종목 (항상 표시)
# ─────────────────────────────────────────────
BASE_TICKERS = {
    'SK하이닉스': '000660.KS',
    '삼성중공업': '010140.KS',
}

# ─────────────────────────────────────────────
# tickers.json 에서 사용자 추가 종목 불러오기
# (파일 없으면 빈 딕셔너리)
# ─────────────────────────────────────────────
TICKERS_FILE = 'tickers.json'

def load_extra_tickers():
    if not os.path.exists(TICKERS_FILE):
        return {}
    try:
        with open(TICKERS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def analyze_signal(latest_close, ma20, ma60):
    """이동평균선 기반 매매 시그널 판독기"""
    if pd.isna(ma20) or pd.isna(ma60):
        return "데이터 부족", "hold", "추세 데이터가 부족합니다."

    if latest_close > ma20 and ma20 > ma60:
        return (
            "🔥 강력 보유 (HOLD)", "hold",
            f"주가({latest_close:,.0f}원)가 20일선 위에 있으며 완벽한 정배열 강세장입니다. "
            "섣부른 매도보다 수익을 극대화하세요."
        )
    elif latest_close < ma20 and ma20 < ma60:
        return (
            "❄️ 비중 축소 (SELL)", "sell",
            f"주가가 20일선 아래로 밀린 역배열 하락 추세입니다. "
            "바닥이 확인될 때까지 신규 매수를 절대 자제하세요."
        )
    elif latest_close > ma20 and ma20 < ma60:
        return (
            "💡 단기 반등 (WATCH)", "buy",
            f"장기 추세는 하락이나 단기 20일선을 회복했습니다. "
            "골든크로스가 나오는지 관찰하며 분할 매수를 준비해볼 타점입니다."
        )
    elif latest_close < ma20 and ma20 > ma60:
        return (
            "⚠️ 단기 이탈 주의 (CAUTION)", "sell",
            f"장기 추세는 양호하나 주가({latest_close:,.0f}원)가 20일선 아래로 이탈했습니다. "
            "추가 하락 여부를 확인한 후 대응하세요."
        )
    else:
        return (
            "⚖️ 횡보 (NEUTRAL)", "hold",
            "뚜렷한 추세가 없는 박스권입니다. 비중을 유지한 채 관망하세요."
        )


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
    elif isinstance(obj, pd.Index):
        return obj.strftime('%Y-%m-%d').tolist() if hasattr(obj, 'strftime') else obj.tolist()
    elif isinstance(obj, list):
        return [convert_to_native(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: convert_to_native(v) for k, v in obj.items()}
    return obj


def fetch_stock(name, ticker):
    """단일 종목 데이터 수집 및 시그널 분석"""
    df = yf.download(ticker, period='1y', progress=False)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.droplevel(1)
    if df.empty:
        raise ValueError("데이터 없음")

    df['MA20'] = df['Close'].rolling(window=20).mean()
    df['MA60'] = df['Close'].rolling(window=60).mean()
    df = df.dropna()

    # Python 네이티브 타입으로 변환
    closes = convert_to_native(df['Close'].values)
    opens = convert_to_native(df['Open'].values)
    lows = convert_to_native(df['Low'].values)
    highs = convert_to_native(df['High'].values)
    volumes = convert_to_native(df['Volume'].values)
    ma20_values = convert_to_native(df['MA20'].values)
    ma60_values = convert_to_native(df['MA60'].values)
    dates = df.index.strftime('%Y-%m-%d').tolist()

    latest_price = float(closes[-1])
    latest_vol = float(volumes[-1])
    latest_ma20 = float(ma20_values[-1])
    latest_ma60 = float(ma60_values[-1])

    signal_text, signal_class, signal_reason = analyze_signal(
        latest_price, latest_ma20, latest_ma60
    )

    # ECharts candlestick format: [open, close, low, high]
    kline_data = [[float(o), float(c), float(l), float(h)] 
                   for o, c, l, h in zip(opens, closes, lows, highs)]

    return {
        'dates': dates,
        'kline': kline_data,
        'volumes': [int(v) for v in volumes],
        'ma20': [float(v) for v in ma20_values],
        'ma60': [float(v) for v in ma60_values],
        'latest_price': latest_price,
        'latest_vol': int(latest_vol),
        'signal_text': signal_text,
        'signal_class': signal_class,
        'signal_reason': signal_reason,
    }


def make_card_html(name, ticker_code, d):
    """종목 카드 HTML 블록 생성"""
    price = d.get('latest_price', 0)
    vol = d.get('latest_vol', 0)
    sig_text = d.get('signal_text', '-')
    sig_class = d.get('signal_class', 'hold')
    sig_reason = d.get('signal_reason', '-')
    chart_id = f"chart_{ticker_code.replace('.','_')}"
    data_var = f"data_{ticker_code.replace('.','_')}"

    # 등락률 계산 (마지막 두 값 비교)
    kline = d.get('kline', [])
    change_pct = 0
    change_class = "neutral"
    if len(kline) >= 2:
        prev_close = kline[-2][1]  # 전일 종가
        curr_close = kline[-1][1]  # 당일 종가
        change_pct = ((curr_close - prev_close) / prev_close) * 100 if prev_close > 0 else 0
        change_class = "up" if change_pct > 0 else "down" if change_pct < 0 else "neutral"

    return f"""
        <div class="card" id="card_{chart_id}">
            <div class="card-header">
                <div class="card-title-wrap">
                    <span class="card-name">{name}</span>
                    <span class="card-code">{ticker_code}</span>
                    <span class="change-badge {change_class}">{change_pct:+.2f}%</span>
                </div>
            </div>
            <div class="kpi-container">
                <div class="kpi">
                    <div class="kpi-title">현재가</div>
                    <div class="kpi-value {change_class}">{price:,.0f}<span class="currency">원</span></div>
                </div>
                <div class="kpi">
                    <div class="kpi-title">거래량</div>
                    <div class="kpi-value">{vol:,.0f}<span class="unit">주</span></div>
                </div>
                <div class="kpi">
                    <div class="kpi-title">20일선</div>
                    <div class="kpi-value ma20">{d.get('ma20', [0])[-1]:,.0f}</div>
                </div>
                <div class="kpi">
                    <div class="kpi-title">60일선</div>
                    <div class="kpi-value ma60">{d.get('ma60', [0])[-1]:,.0f}</div>
                </div>
            </div>
            <div class="signal-box {sig_class}">
                <div class="signal-icon"></div>
                <div class="signal-content">
                    <div class="signal-title">{sig_text}</div>
                    <div class="signal-reason">{sig_reason}</div>
                </div>
            </div>
            <div id="{chart_id}" class="chart"></div>
        </div>"""


def create_dashboard():
    extra_tickers = load_extra_tickers()
    all_tickers = {**BASE_TICKERS, **extra_tickers}

    data = {}
    for name, ticker in all_tickers.items():
        try:
            data[name] = fetch_stock(name, ticker)
            print(f"[OK] {name} ({ticker})")
        except Exception as e:
            print(f"[ERROR] {name} ({ticker}): {e}")
            import traceback
            traceback.print_exc()

    if not data:
        print("데이터를 가져오지 못했습니다. 실행을 중단합니다.")
        return

    # 카드 HTML + JS 데이터 블록 생성
    cards_html = ""
    js_data = ""
    js_render = ""

    for name, ticker in all_tickers.items():
        if name not in data:
            continue
        d = data[name]
        code = ticker
        chart_id = f"chart_{code.replace('.','_')}"
        data_var = f"data_{code.replace('.','_')}"

        cards_html += make_card_html(name, code, d)
        js_data += f"        var {data_var} = {json.dumps(d, ensure_ascii=False)};\n"
        js_render += f"        renderChart('{chart_id}', {data_var}, '{name}');\n"

    # tickers.json 을 JS 변수로 임베드 (삭제 버튼용)
    extra_json = json.dumps(extra_tickers, ensure_ascii=False)

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <title>📈 나만의 주식 대시보드</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        * {{ box-sizing: border-box; }}
        
        :root {{
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-card: #ffffff;
            --text-primary: #1e293b;
            --text-secondary: #64748b;
            --accent-blue: #3b82f6;
            --accent-green: #10b981;
            --accent-red: #ef4444;
            --accent-orange: #f59e0b;
            --border-color: #e2e8f0;
            --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
            --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
            --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
            --radius: 16px;
        }}
        
        body {{
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            background-attachment: fixed;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }}
        
        .header {{
            text-align: center;
            margin-bottom: 30px;
            padding: 20px;
        }}
        
        h1 {{
            color: #ffffff;
            font-size: 2.5rem;
            font-weight: 800;
            margin: 0 0 10px 0;
            text-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        
        .subtitle {{
            color: rgba(255,255,255,0.8);
            font-size: 1.1rem;
            font-weight: 400;
        }}
        
        .container {{
            display: flex;
            flex-direction: column;
            gap: 24px;
            max-width: 1400px;
            margin: auto;
        }}
        
        .card {{
            background: var(--bg-card);
            border-radius: var(--radius);
            padding: 28px;
            box-shadow: var(--shadow-lg);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
            border: 1px solid var(--border-color);
        }}
        
        .card:hover {{
            transform: translateY(-2px);
            box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
        }}
        
        .card-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 2px solid #f1f5f9;
        }}
        
        .card-title-wrap {{ 
            display: flex; 
            align-items: center; 
            gap: 12px; 
        }}
        
        .card-name {{ 
            font-size: 1.5rem; 
            font-weight: 700; 
            color: var(--text-primary);
        }}
        
        .card-code {{ 
            font-size: 0.85rem; 
            color: var(--text-secondary);
            background: #f1f5f9;
            padding: 4px 10px;
            border-radius: 20px;
            font-weight: 500;
        }}
        
        .change-badge {{
            font-size: 0.9rem;
            font-weight: 600;
            padding: 4px 12px;
            border-radius: 20px;
        }}
        
        .change-badge.up {{
            background: #dcfce7;
            color: #166534;
        }}
        
        .change-badge.down {{
            background: #fee2e2;
            color: #991b1b;
        }}
        
        .change-badge.neutral {{
            background: #f1f5f9;
            color: #64748b;
        }}
        
        .kpi-container {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 16px;
            margin-bottom: 20px;
        }}
        
        .kpi {{
            background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
            border-radius: 12px;
            padding: 16px;
            text-align: center;
            border: 1px solid #e2e8f0;
        }}
        
        .kpi-title {{ 
            font-size: 0.75rem; 
            color: var(--text-secondary); 
            font-weight: 600;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            margin-bottom: 6px;
        }}
        
        .kpi-value {{ 
            font-size: 1.4rem; 
            font-weight: 700; 
            color: var(--text-primary);
            display: flex;
            align-items: baseline;
            justify-content: center;
            gap: 4px;
        }}
        
        .kpi-value .currency,
        .kpi-value .unit {{
            font-size: 0.85rem;
            font-weight: 500;
            color: var(--text-secondary);
        }}
        
        .kpi-value.up {{ color: var(--accent-green); }}
        .kpi-value.down {{ color: var(--accent-red); }}
        .kpi-value.ma20 {{ color: #e67e22; }}
        .kpi-value.ma60 {{ color: #2980b9; }}
        
        .signal-box {{
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 24px;
            display: flex;
            align-items: flex-start;
            gap: 16px;
            border-left: 4px solid;
        }}
        
        .signal-box.buy {{ 
            background: linear-gradient(135deg, #dcfce7 0%, #d1fae5 100%);
            border-left-color: var(--accent-green);
        }}
        
        .signal-box.sell {{ 
            background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
            border-left-color: var(--accent-red);
        }}
        
        .signal-box.hold {{ 
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-left-color: var(--accent-orange);
        }}
        
        .signal-icon {{
            font-size: 1.5rem;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            flex-shrink: 0;
        }}
        
        .signal-box.buy .signal-icon::before {{ content: "📈"; }}
        .signal-box.sell .signal-icon::before {{ content: "📉"; }}
        .signal-box.hold .signal-icon::before {{ content: "⚖️"; }}
        
        .signal-content {{
            flex: 1;
        }}
        
        .signal-title {{ 
            font-size: 1.1rem; 
            font-weight: 700; 
            margin-bottom: 6px;
            color: var(--text-primary);
        }}
        
        .signal-reason {{ 
            font-size: 0.9rem; 
            color: var(--text-secondary); 
            line-height: 1.6; 
        }}
        
        .chart {{ 
            width: 100%; 
            height: 450px;
            background: #ffffff;
            border-radius: 12px;
            border: 1px solid var(--border-color);
        }}

        /* ── 종목 추가 패널 ── */
        .add-panel {{
            background: var(--bg-card);
            border-radius: var(--radius);
            padding: 28px;
            box-shadow: var(--shadow-lg);
            border: 1px solid var(--border-color);
        }}
        
        .add-panel h2 {{
            margin: 0 0 8px;
            font-size: 1.3rem;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }}
        
        .add-panel p {{
            margin: 0 0 20px;
            font-size: 0.9rem;
            color: var(--text-secondary);
        }}
        
        .add-row {{
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }}
        
        .add-row input {{
            flex: 1;
            min-width: 180px;
            padding: 12px 16px;
            border: 2px solid #e2e8f0;
            border-radius: 10px;
            font-size: 0.95rem;
            outline: none;
            transition: border-color 0.2s;
        }}
        
        .add-row input:focus {{ 
            border-color: var(--accent-blue);
        }}
        
        .btn-add {{
            padding: 12px 28px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: #fff;
            border: none;
            border-radius: 10px;
            font-size: 0.95rem;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
            transition: transform 0.2s, box-shadow 0.2s;
        }}
        
        .btn-add:hover {{ 
            transform: translateY(-2px);
            box-shadow: 0 10px 20px -5px rgba(102, 126, 234, 0.4);
        }}
        
        .added-list {{
            margin-top: 20px;
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
        }}
        
        .added-tag {{
            display: flex;
            align-items: center;
            gap: 8px;
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            border-radius: 25px;
            padding: 8px 16px;
            font-size: 0.85rem;
            color: #1d4ed8;
            font-weight: 500;
        }}
        
        .added-tag button {{
            background: none;
            border: none;
            cursor: pointer;
            color: #ef4444;
            font-size: 18px;
            line-height: 1;
            padding: 0;
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            transition: background 0.2s;
        }}
        
        .added-tag button:hover {{
            background: #fee2e2;
        }}
        
        .notice {{
            margin-top: 20px;
            padding: 16px;
            background: #f8fafc;
            border-radius: 10px;
            font-size: 0.85rem;
            color: var(--text-secondary);
            line-height: 1.7;
            border: 1px solid #e2e8f0;
        }}
        
        .notice a {{ 
            color: var(--accent-blue); 
            text-decoration: none;
            font-weight: 500;
        }}
        
        .notice a:hover {{ text-decoration: underline; }}
        
        .msg-error {{ 
            color: var(--accent-red); 
            font-size: 0.9rem; 
            margin-top: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
        }}
        
        .msg-error::before {{
            content: "⚠️";
        }}

        @media (max-width: 768px) {{
            body {{ padding: 12px; }}
            h1 {{ font-size: 1.8rem; }}
            .card {{ padding: 20px; }}
            .chart {{ height: 350px; }}
            .kpi-value {{ font-size: 1.1rem; }}
            .kpi-container {{ grid-template-columns: repeat(2, 1fr); }}
            .signal-box {{ flex-direction: column; gap: 12px; }}
        }}
        
        /* Loading spinner */
        .chart-loading {{
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-secondary);
        }}
        
        .spinner {{
            width: 40px;
            height: 40px;
            border: 4px solid #e2e8f0;
            border-top: 4px solid var(--accent-blue);
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }}
        
        @keyframes spin {{
            0% {{ transform: rotate(0deg); }}
            100% {{ transform: rotate(360deg); }}
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>📈 스마트 주식 대시보드</h1>
        <div class="subtitle">실시간 주식 분석 & 매매 시그널</div>
    </div>
    
    <div class="container" id="mainContainer">
{cards_html}

        <div class="add-panel">
            <h2>➕ 종목 추가</h2>
            <p>한국 주식 종목 코드(6자리 숫자)와 표시할 이름을 입력하세요.</p>
            <div class="add-row">
                <input type="text" id="inputName" placeholder="종목명  예) 삼성전자" maxlength="20">
                <input type="text" id="inputCode" placeholder="종목코드  예) 005930" maxlength="10">
                <button class="btn-add" onclick="addTicker()">추가하기</button>
            </div>
            <div id="errorMsg" class="msg-error" style="display: none;"></div>
            <div class="added-list" id="addedList"></div>
            <div class="notice">
                <strong>ℹ️ 안내사항</strong><br>
                • 추가한 종목 코드는 <b>tickers.json</b> 파일에 저장됩니다.<br>
                • GitHub Actions가 다음에 실행될 때 차트가 자동으로 생성됩니다.<br>
                • 종목 코드는 <a href="https://finance.yahoo.com" target="_blank">Yahoo Finance</a>에서 확인하세요. 한국 주식은 코드 뒤에 <b>.KS</b>(유가증권) 또는 <b>.KQ</b>(코스닥)가 붙습니다.
            </div>
        </div>
    </div>

    <script>
{js_data}

        // 사용자가 추가한 종목 목록 (현재 tickers.json 내용)
        var extraTickers = {extra_json};

        function renderAddedList() {{
            var list = document.getElementById('addedList');
            list.innerHTML = '';
            Object.keys(extraTickers).forEach(function(name) {{
                var code = extraTickers[name];
                var tag = document.createElement('div');
                tag.className = 'added-tag';
                tag.innerHTML =
                    '<span>' + name + ' <b>(' + code + ')</b></span>' +
                    '<button title="삭제" onclick="removeTicker(\\'' + name + '\\')">×</button>';
                list.appendChild(tag);
            }});
        }}

        function addTicker() {{
            var name = document.getElementById('inputName').value.trim();
            var code = document.getElementById('inputCode').value.trim().toUpperCase();
            var err = document.getElementById('errorMsg');
            err.style.display = 'none';
            err.textContent = '';

            if (!name) {{ err.textContent = '종목명을 입력해 주세요.'; err.style.display = 'flex'; return; }}
            if (!code) {{ err.textContent = '종목 코드를 입력해 주세요.'; err.style.display = 'flex'; return; }}

            // 숫자만 입력하면 .KS 자동 추가
            if (/^\\d{{6}}$/.test(code)) code = code + '.KS';

            // 간단한 형식 검증
            if (!/^\\d{{6}}\\.(KS|KQ)$/i.test(code)) {{
                err.textContent = '올바른 형식이 아닙니다. 예) 005930 또는 005930.KS';
                err.style.display = 'flex';
                return;
            }}

            if (extraTickers[name]) {{
                err.textContent = '이미 추가된 종목명입니다.';
                err.style.display = 'flex';
                return;
            }}

            extraTickers[name] = code;
            saveAndNotify();
            document.getElementById('inputName').value = '';
            document.getElementById('inputCode').value = '';
        }}

        function removeTicker(name) {{
            if (!confirm(name + ' 종목을 삭제할까요?')) return;
            delete extraTickers[name];
            saveAndNotify();
        }}

        function saveAndNotify() {{
            var blob = new Blob(
                [JSON.stringify(extraTickers, null, 2)],
                {{type: 'application/json'}}
            );
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'tickers.json';
            a.click();
            URL.revokeObjectURL(url);
            renderAddedList();
            alert('tickers.json 파일이 다운로드되었습니다.\\n레포지토리 루트에 업로드하면 다음 Actions 실행 시 자동 반영됩니다.');
        }}

        function renderChart(elementId, chartData, title) {{
            var container = document.getElementById(elementId);
            if (!container) {{
                console.error('Chart container not found:', elementId);
                return;
            }}
            
            if (!chartData || !chartData.dates || chartData.dates.length === 0) {{
                container.innerHTML = '<div class="chart-loading">데이터가 없습니다.</div>';
                return;
            }}
            
            // Container 초기화
            container.innerHTML = '';
            
            try {{
                var chart = echarts.init(container);
                
                var option = {{
                    animation: true,
                    animationDuration: 1000,
                    title: {{ 
                        text: title + ' 차트', 
                        left: 'center',
                        textStyle: {{
                            fontSize: 16,
                            fontWeight: 'bold',
                            color: '#1e293b'
                        }}
                    }},
                    tooltip: {{ 
                        trigger: 'axis', 
                        axisPointer: {{ type: 'cross' }},
                        backgroundColor: 'rgba(255,255,255,0.95)',
                        borderColor: '#e2e8f0',
                        borderWidth: 1,
                        textStyle: {{ color: '#1e293b' }},
                        formatter: function(params) {{
                            var result = '<strong>' + params[0].axisValue + '</strong><br/>';
                            params.forEach(function(item) {{
                                if (item.seriesName === 'Candlestick') {{
                                    var data = item.data;
                                    result += '시가: ' + data[1].toLocaleString() + '<br/>';
                                    result += '종가: ' + data[2].toLocaleString() + '<br/>';
                                    result += '저가: ' + data[3].toLocaleString() + '<br/>';
                                    result += '고가: ' + data[4].toLocaleString() + '<br/>';
                                }} else if (item.seriesName === 'Volume') {{
                                    result += '거래량: ' + item.data.toLocaleString() + '주<br/>';
                                }} else {{
                                    result += item.marker + ' ' + item.seriesName + ': ' + item.data.toLocaleString() + '<br/>';
                                }}
                            }});
                            return result;
                        }}
                    }},
                    legend: {{ 
                        data: ['캔들차트', 'MA20', 'MA60', '거래량'], 
                        top: 35,
                        textStyle: {{ color: '#64748b' }}
                    }},
                    grid: [
                        {{ left: '3%', right: '3%', top: '15%', height: '55%' }},
                        {{ left: '3%', right: '3%', top: '75%', height: '15%' }}
                    ],
                    xAxis: [
                        {{ 
                            type: 'category', 
                            data: chartData.dates, 
                            gridIndex: 0, 
                            boundaryGap: true,
                            axisLine: {{ lineStyle: {{ color: '#e2e8f0' }} }},
                            axisLabel: {{ color: '#64748b', fontSize: 11 }}
                        }},
                        {{ 
                            type: 'category', 
                            data: chartData.dates, 
                            gridIndex: 1, 
                            boundaryGap: true, 
                            show: false 
                        }}
                    ],
                    yAxis: [
                        {{ 
                            scale: true, 
                            gridIndex: 0,
                            axisLine: {{ show: false }},
                            axisLabel: {{ 
                                color: '#64748b',
                                formatter: function(value) {{
                                    return value.toLocaleString();
                                }}
                            }},
                            splitLine: {{ lineStyle: {{ color: '#f1f5f9' }} }}
                        }},
                        {{ 
                            scale: true, 
                            gridIndex: 1, 
                            splitNumber: 2,
                            axisLabel: {{ show: false }}, 
                            axisLine: {{ show: false }}, 
                            splitLine: {{ show: false }} 
                        }}
                    ],
                    dataZoom: [
                        {{ type: 'inside', xAxisIndex: [0, 1], start: 50, end: 100 }},
                        {{ show: true, type: 'slider', xAxisIndex: [0, 1], top: '92%', start: 50, end: 100, height: 20 }}
                    ],
                    series: [
                        {{ 
                            name: '캔들차트', 
                            type: 'candlestick', 
                            data: chartData.kline,
                            xAxisIndex: 0, 
                            yAxisIndex: 0,
                            itemStyle: {{ 
                                color: '#ef4444', 
                                color0: '#3b82f6',
                                borderColor: '#ef4444', 
                                borderColor0: '#3b82f6',
                                borderWidth: 1
                            }}
                        }},
                        {{ 
                            name: 'MA20', 
                            type: 'line', 
                            data: chartData.ma20,
                            xAxisIndex: 0, 
                            yAxisIndex: 0,
                            smooth: true, 
                            lineStyle: {{ color: '#f59e0b', width: 2 }}, 
                            symbol: 'none',
                            showSymbol: false
                        }},
                        {{ 
                            name: 'MA60', 
                            type: 'line', 
                            data: chartData.ma60,
                            xAxisIndex: 0, 
                            yAxisIndex: 0,
                            smooth: true, 
                            lineStyle: {{ color: '#8b5cf6', width: 2 }}, 
                            symbol: 'none',
                            showSymbol: false
                        }},
                        {{ 
                            name: '거래량', 
                            type: 'bar', 
                            data: chartData.volumes,
                            xAxisIndex: 1, 
                            yAxisIndex: 1,
                            itemStyle: {{ 
                                color: function(params) {{
                                    var kline = chartData.kline[params.dataIndex];
                                    return kline && kline[1] >= kline[0] ? 'rgba(59, 130, 246, 0.6)' : 'rgba(239, 68, 68, 0.6)';
                                }}
                            }}
                        }}
                    ]
                }};
                
                chart.setOption(option);
                
                // Flexbox 초기 렌더링 지연 문제를 방지하기 위해 리사이즈
                setTimeout(function() {{
                    chart.resize();
                }}, 100);

                window.addEventListener('resize', function() {{ chart.resize(); }});
                
            }} catch (e) {{
                console.error('Chart rendering error:', e);
                container.innerHTML = '<div class="chart-loading" style="color: #ef4444;">차트 렌더링 오류: ' + e.message + '</div>';
            }}
        }}

        window.onload = function() {{
{js_render}
            renderAddedList();
        }};
    </script>
</body>
</html>"""

    with open('dashboard.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("dashboard.html 생성 완료")


if __name__ == '__main__':
    create_dashboard()
