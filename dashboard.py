import yfinance as yf
import pandas as pd
import json

def create_dashboard():
    tickers = {'SK하이닉스': '000660.KS', '삼성중공업': '010140.KS'}
    data = {}
    
    for name, ticker in tickers.items():
        try:
            df = yf.download(ticker, period='1y', progress=False)
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)
            
            # 기술적 지표 계산
            df['MA20'] = df['Close'].rolling(window=20).mean()
            df['MA60'] = df['Close'].rolling(window=60).mean()
            df = df.dropna()
            
            dates = df.index.strftime('%Y-%m-%d').tolist()
            closes = df['Close'].values.tolist()
            opens = df['Open'].values.tolist()
            lows = df['Low'].values.tolist()
            highs = df['High'].values.tolist()
            volumes = df['Volume'].values.tolist()
            
            data[name] = {
                'dates': dates,
                'kline': [[o, c, l, h] for o, c, l, h in zip(opens, closes, lows, highs)],
                'volumes': volumes,
                'ma20': df['MA20'].values.tolist(),
                'ma60': df['MA60'].values.tolist(),
                'latest_price': float(closes[-1]),
                'latest_vol': float(volumes[-1])
            }
        except Exception as e:
            print(f"Error processing {name}: {e}")

    # HTML 렌더링
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <title>포트폴리오 전술 대시보드</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src="https://cdn.jsdelivr.net/npm/echarts/dist/echarts.min.js"></script>
        <style>
            body {{ font-family: 'Segoe UI', sans-serif; background-color: #f0f2f5; margin: 0; padding: 20px; }}
            .container {{ display: flex; flex-direction: column; gap: 20px; max-width: 1200px; margin: auto; }}
            .card {{ background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }}
            h1 {{ text-align: center; color: #1a1a1a; }}
            .kpi-container {{ display: flex; justify-content: space-around; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px; }}
            .kpi {{ text-align: center; flex: 1; }}
            .kpi-title {{ font-size: 14px; color: #7f8c8d; font-weight: 600; letter-spacing: 1px; }}
            .kpi-value {{ font-size: 28px; font-weight: bold; color: #2c3e50; margin-top: 5px; }}
            .chart {{ width: 100%; height: 500px; }}
            @media (max-width: 768px) {{ .chart {{ height: 400px; }} .kpi-value {{ font-size: 20px; }} }}
        </style>
    </head>
    <body>
        <h1>🔥 일일 전술 대시보드 (SK하이닉스 & 삼성중공업)</h1>
        <div class="container">
            <div class="card">
                <div class="kpi-container">
                    <div class="kpi"><div class="kpi-title">SK하이닉스 종가 (원)</div><div class="kpi-value">{data.get('SK하이닉스', {{}}).get('latest_price', 0):,.0f}</div></div>
                    <div class="kpi"><div class="kpi-title">24H 거래량</div><div class="kpi-value">{data.get('SK하이닉스', {{}}).get('latest_vol', 0):,.0f}</div></div>
                </div>
                <div id="hynixChart" class="chart"></div>
            </div>
            <div class="card">
                <div class="kpi-container">
                    <div class="kpi"><div class="kpi-title">삼성중공업 종가 (원)</div><div class="kpi-value">{data.get('삼성중공업', {{}}).get('latest_price', 0):,.0f}</div></div>
                    <div class="kpi"><div class="kpi-title">24H 거래량</div><div class="kpi-value">{data.get('삼성중공업', {{}}).get('latest_vol', 0):,.0f}</div></div>
                </div>
                <div id="shiChart" class="chart"></div>
            </div>
        </div>
        <script>
            var hynixData = {json.dumps(data.get('SK하이닉스', {}))};
            var shiData = {json.dumps(data.get('삼성중공업', {}))};
            
            function renderChart(elementId, chartData, title) {{
                if (!chartData.dates) return;
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
                        {{ scale: true, gridIndex: 1, splitNumber: 2, axisLabel: {{ show: false }}, axisLine: {{ show: false }}, splitLine: {{ show: false }} }}
                    ],
                    dataZoom: [
                        {{ type: 'inside', xAxisIndex: [0, 1], start: 0, end: 100 }},
                        {{ show: true, type: 'slider', xAxisIndex: [0, 1], start: 0, end: 100 }}
                    ],
                    series: [
                        {{ name: 'Candlestick', type: 'candlestick', data: chartData.kline, xAxisIndex: 0, yAxisIndex: 0,
                           itemStyle: {{ color: '#ef232a', color0: '#14b143', borderColor: '#ef232a', borderColor0: '#14b143' }} }},
                        {{ name: 'MA20', type: 'line', data: chartData.ma20, smooth: true, lineStyle: {{ color: '#e67e22', width: 2 }}, symbol: 'none' }},
                        {{ name: 'MA60', type: 'line', data: chartData.ma60, smooth: true, lineStyle: {{ color: '#2980b9', width: 2 }}, symbol: 'none' }},
                        {{ name: 'Volume', type: 'bar', data: chartData.volumes, xAxisIndex: 1, yAxisIndex: 1, itemStyle: {{ color: '#7f8c8d' }} }}
                    ]
                }};
                chart.setOption(option);
                window.addEventListener('resize', function() {{ chart.resize(); }});
            }}
            renderChart('hynixChart', hynixData, 'SK하이닉스 추세 (모바일 최적화)');
            renderChart('shiChart', shiData, '삼성중공업 추세 (모바일 최적화)');
        </script>
    </body>
    </html>
    """
    
    with open('dashboard.html', 'w', encoding='utf-8') as f:
        f.write(html_content)

if __name__ == "__main__":
    create_dashboard()
