import yfinance as yf
import pandas as pd
import json

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
        # 기존 else 케이스를 명확히 분리 — 단기 이탈 경계 신호
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


def create_dashboard():
    tickers = {'SK하이닉스': '000660.KS', '삼성중공업': '010140.KS'}
    data = {}

    for name, ticker in tickers.items():
        try:
            df = yf.download(ticker, period='1y', progress=False)
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)

            df['MA20'] = df['Close'].rolling(window=20).mean()
            df['MA60'] = df['Close'].rolling(window=60).mean()
            df = df.dropna()

            dates = df.index.strftime('%Y-%m-%d').tolist()
            closes = df['Close'].values.tolist()
            opens = df['Open'].values.tolist()
            lows = df['Low'].values.tolist()
            highs = df['High'].values.tolist()
            volumes = df['Volume'].values.tolist()

            latest_price = float(closes[-1])
            latest_vol = float(volumes[-1])
            latest_ma20 = float(df['MA20'].iloc[-1])
            latest_ma60 = float(df['MA60'].iloc[-1])

            signal_text, signal_class, signal_reason = analyze_signal(
                latest_price, latest_ma20, latest_ma60
            )

            data[name] = {
                'dates': dates,
                'kline': [[o, c, l, h] for o, c, l, h in zip(opens, closes, lows, highs)],
                'volumes': volumes,
                'ma20': df['MA20'].values.tolist(),
                'ma60': df['MA60'].values.tolist(),
                'latest_price': latest_price,
                'latest_vol': latest_vol,
                'signal_text': signal_text,
                'signal_class': signal_class,
                'signal_reason': signal_reason,
            }
        except Exception as e:
            print(f"Error processing {name}: {e}")

    if not data:
        print("데이터를 가져오지 못했습니다. 실행을 중단합니다.")
        return

    # 데이터 추출 (f-string 이중 중괄호 버그 방지 — 변수로 미리 분리)
    h_data = data.get('SK하이닉스', {})
    s_data = data.get('삼성중공업', {})

    hynix_json = json.dumps(h_data, ensure_ascii=False)
    shi_json   = json.dumps(s_data, ensure_ascii=False)

    h_price      = h_data.get('latest_price', 0)
    h_vol        = h_data.get('latest_vol', 0)
    h_signal     = h_data.get('signal_text', '-')
    h_class      = h_data.get('signal_class', 'hold')
    h_reason     = h_data.get('signal_reason', '-')

    s_price      = s_data.get('latest_price', 0)
    s_vol        = s_data.get('latest_vol', 0)
    s_signal     = s_data.get('signal_text', '-')
    s_class      = s_data.get('signal_class', 'hold')
    s_reason     = s_data.get('signal_reason', '-')

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

        /* ✅ 시그널 박스 스타일 */
        .signal-box {{
            border-radius: 8px;
            padding: 14px 18px;
            margin-bottom: 16px;
        }}
        .signal-box.buy {{
            background: #eafaf1;
            border-left: 5px solid #27ae60;
        }}
        .signal-box.sell {{
            background: #fdf2f2;
            border-left: 5px solid #e74c3c;
        }}
        .signal-box.hold {{
            background: #fef9e7;
            border-left: 5px solid #f39c12;
        }}
        .signal-title {{
            font-size: 17px;
            font-weight: 700;
            margin-bottom: 6px;
            color: #2c3e50;
        }}
        .signal-reason {{
            font-size: 13px;
            color: #555;
            line-height: 1.6;
        }}

        .chart {{ width: 100%; height: 500px; }}
        @media (max-width: 768px) {{
            .chart {{ height: 380px; }}
            .kpi-value {{ font-size: 20px; }}
            .signal-title {{ font-size: 15px; }}
        }}
    </style>
</head>
<body>
    <h1>🔥 일일 전술 대시보드 (SK하이닉스 & 삼성중공업)</h1>
    <div class="container">

        <!-- SK하이닉스 -->
        <div class="card">
            <div class="kpi-container">
                <div class="kpi">
                    <div class="kpi-title">SK하이닉스 종가 (원)</div>
                    <div class="kpi-value">{h_price:,.0f}</div>
                </div>
                <div class="kpi">
                    <div class="kpi-title">당일 거래량 (주)</div>
                    <div class="kpi-value">{h_vol:,.0f}</div>
                </div>
            </div>
            <div class="signal-box {h_class}">
                <div class="signal-title">{h_signal}</div>
                <div class="signal-reason">{h_reason}</div>
            </div>
            <div id="hynixChart" class="chart"></div>
        </div>

        <!-- 삼성중공업 -->
        <div class="card">
            <div class="kpi-container">
                <div class="kpi">
                    <div class="kpi-title">삼성중공업 종가 (원)</div>
                    <div class="kpi-value">{s_price:,.0f}</div>
                </div>
                <div class="kpi">
                    <div class="kpi-title">당일 거래량 (주)</div>
                    <div class="kpi-value">{s_vol:,.0f}</div>
                </div>
            </div>
            <div class="signal-box {s_class}">
                <div class="signal-title">{s_signal}</div>
                <div class="signal-reason">{s_reason}</div>
            </div>
            <div id="shiChart" class="chart"></div>
        </div>

    </div>

    <script>
        var hynixData = {hynix_json};
        var shiData   = {shi_json};

        function renderChart(elementId, chartData, title) {{
            if (!chartData || !chartData.dates) return;
            var chart = echarts.init(document.getElementById(elementId));
            var option = {{
                title: {{ text: title, left: 'center' }},
                tooltip: {{ trigger: 'axis', axisPointer: {{ type: 'cross' }} }},
                legend: {{ data: ['Candlestick', 'MA20', 'MA60'], top: 30 }},
                grid: [
                    {{ left: '5%', right: '5%', height: '50%' }},
                    {{ left: '5%', right: '5%', top: '70%', height: '15%' }}
                ],
                xAxis: [
                    {{ type: 'category', data: chartData.dates, gridIndex: 0, scale: true, boundaryGap: false }},
                    {{ type: 'category', data: chartData.dates, gridIndex: 1, scale: true, boundaryGap: false, show: false }}
                ],
                yAxis: [
                    {{ scale: true, gridIndex: 0 }},
                    {{ scale: true, gridIndex: 1, splitNumber: 2,
                       axisLabel: {{ show: false }}, axisLine: {{ show: false }}, splitLine: {{ show: false }} }}
                ],
                dataZoom: [
                    {{ type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 }},
                    {{ show: true, type: 'slider', xAxisIndex: [0, 1], start: 0, end: 100 }}
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
            window.addEventListener('resize', function() {{ chart.resize(); }});
        }}

        renderChart('hynixChart', hynixData, 'SK하이닉스 추세');
        renderChart('shiChart',   shiData,   '삼성중공업 추세');
    </script>
</body>
</html>"""

    with open('dashboard.html', 'w', encoding='utf-8') as f:
        f.write(html)
    print("dashboard.html 생성 완료")


if __name__ == '__main__':
    create_dashboard()
