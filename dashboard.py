import yfinance as yf
import pandas as pd
import json
import os

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

    closes  = df['Close'].values.tolist()
    opens   = df['Open'].values.tolist()
    lows    = df['Low'].values.tolist()
    highs   = df['High'].values.tolist()
    volumes = df['Volume'].values.tolist()

    latest_price = float(closes[-1])
    latest_vol   = float(volumes[-1])
    latest_ma20  = float(df['MA20'].iloc[-1])
    latest_ma60  = float(df['MA60'].iloc[-1])

    signal_text, signal_class, signal_reason = analyze_signal(
        latest_price, latest_ma20, latest_ma60
    )

    return {
        'dates':        df.index.strftime('%Y-%m-%d').tolist(),
        'kline':        [[o, c, l, h] for o, c, l, h in zip(opens, closes, lows, highs)],
        'volumes':      volumes,
        'ma20':         df['MA20'].values.tolist(),
        'ma60':         df['MA60'].values.tolist(),
        'latest_price': latest_price,
        'latest_vol':   latest_vol,
        'signal_text':  signal_text,
        'signal_class': signal_class,
        'signal_reason': signal_reason,
    }


def make_card_html(name, ticker_code, d):
    """종목 카드 HTML 블록 생성"""
    price      = d.get('latest_price', 0)
    vol        = d.get('latest_vol', 0)
    sig_text   = d.get('signal_text', '-')
    sig_class  = d.get('signal_class', 'hold')
    sig_reason = d.get('signal_reason', '-')
    chart_id   = f"chart_{ticker_code.replace('.','_')}"
    data_var   = f"data_{ticker_code.replace('.','_')}"

    return f"""
        <div class="card" id="card_{chart_id}">
            <div class="card-header">
                <div class="card-title-wrap">
                    <span class="card-name">{name}</span>
                    <span class="card-code">{ticker_code}</span>
                </div>
            </div>
            <div class="kpi-container">
                <div class="kpi">
                    <div class="kpi-title">종가 (원)</div>
                    <div class="kpi-value">{price:,.0f}</div>
                </div>
                <div class="kpi">
                    <div class="kpi-title">당일 거래량 (주)</div>
                    <div class="kpi-value">{vol:,.0f}</div>
                </div>
            </div>
            <div class="signal-box {sig_class}">
                <div class="signal-title">{sig_text}</div>
                <div class="signal-reason">{sig_reason}</div>
            </div>
            <div id="{chart_id}" class="chart"></div>
        </div>"""


def create_dashboard():
    extra_tickers = load_extra_tickers()
    all_tickers   = {**BASE_TICKERS, **extra_tickers}

    data = {}
    for name, ticker in all_tickers.items():
        try:
            data[name] = fetch_stock(name, ticker)
            print(f"[OK] {name} ({ticker})")
        except Exception as e:
            print(f"[ERROR] {name} ({ticker}): {e}")

    if not data:
        print("데이터를 가져오지 못했습니다. 실행을 중단합니다.")
        return

    # 카드 HTML + JS 데이터 블록 생성
    cards_html   = ""
    js_data      = ""
    js_render    = ""

    for name, ticker in all_tickers.items():
        if name not in data:
            continue
        d         = data[name]
        code      = ticker
        chart_id  = f"chart_{code.replace('.','_')}"
        data_var  = f"data_{code.replace('.','_')}"

        cards_html += make_card_html(name, code, d)
        js_data    += f"        var {data_var} = {json.dumps(d, ensure_ascii=False)};\n"
        js_render  += f"        renderChart('{chart_id}', {data_var}, '{name} 추세');\n"

    # tickers.json 을 JS 변수로 임베드 (삭제 버튼용)
    extra_json = json.dumps(extra_tickers, ensure_ascii=False)

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="utf-8">
    <title>포트폴리오 전술 대시보드</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        * {{ box-sizing: border-box; }}
        body {{
            font-family: 'Segoe UI', sans-serif;
            background-color: #f0f2f5;
            margin: 0;
            padding: 20px;
        }}
        .container {{
            display: flex;
            flex-direction: column;
            gap: 20px;
            max-width: 1200px;
            margin: auto;
        }}
        h1 {{
            text-align: center;
            color: #1a1a1a;
            margin-bottom: 10px;
        }}
        .card {{
            background: #fff;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }}
        .card-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }}
        .card-title-wrap {{ display: flex; align-items: baseline; gap: 8px; }}
        .card-name {{ font-size: 18px; font-weight: 700; color: #1a1a1a; }}
        .card-code {{ font-size: 12px; color: #999; }}
        .btn-remove {{
            background: none;
            border: 1px solid #e74c3c;
            color: #e74c3c;
            border-radius: 6px;
            padding: 4px 10px;
            font-size: 12px;
            cursor: pointer;
        }}
        .btn-remove:hover {{ background: #fdf2f2; }}
        .kpi-container {{
            display: flex;
            justify-content: space-around;
            margin-bottom: 16px;
            border-bottom: 1px solid #eee;
            padding-bottom: 15px;
        }}
        .kpi {{ text-align: center; flex: 1; }}
        .kpi-title {{ font-size: 14px; color: #7f8c8d; font-weight: 600; letter-spacing: 1px; }}
        .kpi-value {{ font-size: 28px; font-weight: bold; color: #2c3e50; margin-top: 5px; }}
        .signal-box {{
            border-radius: 8px;
            padding: 14px 18px;
            margin-bottom: 16px;
        }}
        .signal-box.buy  {{ background: #eafaf1; border-left: 5px solid #27ae60; }}
        .signal-box.sell {{ background: #fdf2f2; border-left: 5px solid #e74c3c; }}
        .signal-box.hold {{ background: #fef9e7; border-left: 5px solid #f39c12; }}
        .signal-title  {{ font-size: 17px; font-weight: 700; margin-bottom: 6px; color: #2c3e50; }}
        .signal-reason {{ font-size: 13px; color: #555; line-height: 1.6; }}
        .chart {{ width: 100%; height: 500px; }}

        /* ── 종목 추가 패널 ── */
        .add-panel {{
            background: #fff;
            border-radius: 12px;
            padding: 24px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }}
        .add-panel h2 {{
            margin: 0 0 6px;
            font-size: 16px;
            color: #2c3e50;
        }}
        .add-panel p {{
            margin: 0 0 16px;
            font-size: 13px;
            color: #7f8c8d;
        }}
        .add-row {{
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }}
        .add-row input {{
            flex: 1;
            min-width: 140px;
            padding: 10px 14px;
            border: 1px solid #ddd;
            border-radius: 8px;
            font-size: 14px;
            outline: none;
        }}
        .add-row input:focus {{ border-color: #3498db; }}
        .btn-add {{
            padding: 10px 22px;
            background: #3498db;
            color: #fff;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            white-space: nowrap;
        }}
        .btn-add:hover {{ background: #2980b9; }}
        .added-list {{
            margin-top: 16px;
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }}
        .added-tag {{
            display: flex;
            align-items: center;
            gap: 6px;
            background: #eaf4fd;
            border: 1px solid #aed6f1;
            border-radius: 20px;
            padding: 5px 12px;
            font-size: 13px;
            color: #2471a3;
        }}
        .added-tag button {{
            background: none;
            border: none;
            cursor: pointer;
            color: #e74c3c;
            font-size: 15px;
            line-height: 1;
            padding: 0;
        }}
        .notice {{
            margin-top: 14px;
            padding: 10px 14px;
            background: #f8f9fa;
            border-radius: 8px;
            font-size: 12px;
            color: #7f8c8d;
            line-height: 1.7;
        }}
        .notice a {{ color: #3498db; text-decoration: none; }}
        .notice a:hover {{ text-decoration: underline; }}
        .msg-error {{ color: #e74c3c; font-size: 13px; margin-top: 8px; }}

        @media (max-width: 768px) {{
            .chart {{ height: 380px; }}
            .kpi-value {{ font-size: 20px; }}
            .signal-title {{ font-size: 15px; }}
        }}
    </style>
</head>
<body>
    <h1>🔥 일일 전술 대시보드</h1>
    <div class="container" id="mainContainer">
{cards_html}

        <div class="add-panel">
            <h2>➕ 종목 추가</h2>
            <p>한국 주식 종목 코드(6자리 숫자)와 표시할 이름을 입력하세요.</p>
            <div class="add-row">
                <input type="text" id="inputName"   placeholder="종목명  예) 삼성전자" maxlength="20">
                <input type="text" id="inputCode"   placeholder="종목코드  예) 005930" maxlength="10">
                <button class="btn-add" onclick="addTicker()">추가하기</button>
            </div>
            <div id="errorMsg" class="msg-error"></div>
            <div class="added-list" id="addedList"></div>
            <div class="notice">
                ℹ️ 추가한 종목 코드는 <b>tickers.json</b> 파일에 저장됩니다.<br>
                GitHub Actions가 다음에 실행될 때 차트가 자동으로 생성됩니다.<br>
                종목 코드는 <a href="https://finance.yahoo.com" target="_blank">Yahoo Finance</a>에서 확인하세요. 한국 주식은 코드 뒤에 <b>.KS</b>(유가증권) 또는 <b>.KQ</b>(코스닥)가 붙습니다.
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
                var tag  = document.createElement('div');
                tag.className = 'added-tag';
                tag.innerHTML =
                    '<span>' + name + ' <b>(' + code + ')</b></span>' +
                    '<button title="삭제" onclick="removeTicker(\'' + name + '\')">×</button>';
                list.appendChild(tag);
            }});
        }}

        function addTicker() {{
            var name = document.getElementById('inputName').value.trim();
            var code = document.getElementById('inputCode').value.trim().toUpperCase();
            var err  = document.getElementById('errorMsg');
            err.textContent = '';

            if (!name) {{ err.textContent = '종목명을 입력해 주세요.'; return; }}
            if (!code)  {{ err.textContent = '종목 코드를 입력해 주세요.'; return; }}

            // 숫자만 입력하면 .KS 자동 추가
            if (/^\\d{{6}}$/.test(code)) code = code + '.KS';

            // 간단한 형식 검증
            if (!/^\\d{{6}}\\.(KS|KQ)$/i.test(code)) {{
                err.textContent = '올바른 형식이 아닙니다. 예) 005930 또는 005930.KS';
                return;
            }}

            if (extraTickers[name]) {{
                err.textContent = '이미 추가된 종목명입니다.';
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
            var url  = URL.createObjectURL(blob);
            var a    = document.createElement('a');
            a.href   = url;
            a.download = 'tickers.json';
            a.click();
            URL.revokeObjectURL(url);
            renderAddedList();
            alert('tickers.json 파일이 다운로드되었습니다.\\n레포지토리 루트에 업로드하면 다음 Actions 실행 시 자동 반영됩니다.');
        }}

        function renderChart(elementId, chartData, title) {{
            if (!chartData || !chartData.dates) return;
            var chart = echarts.init(document.getElementById(elementId));
            var option = {{
                title: {{ text: title, left: 'center' }},
                tooltip: {{ trigger: 'axis', axisPointer: {{ type: 'cross' }} }},
                legend: {{ data: ['Candlestick', 'MA20', 'MA60'], top: 30 }},
                grid: [
                    {{ left: '5%', right: '5%', top: '12%', height: '50%' }},
                    {{ left: '5%', right: '5%', top: '72%', height: '15%' }}
                ],
                xAxis: [
                    {{ type: 'category', data: chartData.dates, gridIndex: 0, boundaryGap: false }},
                    {{ type: 'category', data: chartData.dates, gridIndex: 1, boundaryGap: false, show: false }}
                ],
                yAxis: [
                    {{ scale: true, gridIndex: 0 }},
                    {{ scale: true, gridIndex: 1, splitNumber: 2,
                       axisLabel: {{ show: false }}, axisLine: {{ show: false }}, splitLine: {{ show: false }} }}
                ],
                dataZoom: [
                    {{ type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 }},
                    {{ show: true, type: 'slider', xAxisIndex: [0, 1], top: '92%', start: 0, end: 100 }}
                ],
                series: [
                    {{ name: 'Candlestick', type: 'candlestick', data: chartData.kline,
                       xAxisIndex: 0, yAxisIndex: 0,
                       itemStyle: {{ color: '#ef232a', color0: '#14b143',
                                     borderColor: '#ef232a', borderColor0: '#14b143' }} }},
                    {{ name: 'MA20', type: 'line', data: chartData.ma20,
                       xAxisIndex: 0, yAxisIndex: 0,
                       smooth: true, lineStyle: {{ color: '#e67e22', width: 2 }}, symbol: 'none' }},
                    {{ name: 'MA60', type: 'line', data: chartData.ma60,
                       xAxisIndex: 0, yAxisIndex: 0,
                       smooth: true, lineStyle: {{ color: '#2980b9', width: 2 }}, symbol: 'none' }},
                    {{ name: 'Volume', type: 'bar', data: chartData.volumes,
                       xAxisIndex: 1, yAxisIndex: 1,
                       itemStyle: {{ color: '#7f8c8d' }} }}
                ]
            }};
            chart.setOption(option);
            
            // Flexbox 초기 렌더링 지연 문제를 방지하기 위해 50ms 후 강제 리사이즈 실행
            setTimeout(function() {{
                chart.resize();
            }}, 50);

            window.addEventListener('resize', function() {{ chart.resize(); }});
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
