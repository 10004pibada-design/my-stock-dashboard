import yfinance as yf
import pandas as pd
import json

def analyze_signal(latest_close, ma20, ma60):
    """간단한 이동평균선 기반 AI 매매 시그널 판독기"""
    if pd.isna(ma20) or pd.isna(ma60):
        return "데이터 부족", "hold", "추세 데이터가 부족합니다."
        
    if latest_close > ma20 and ma20 > ma60:
        return "🔥 강력 보유 (HOLD)", "hold", f"주가({latest_close:,.0f}원)가 20일선 위에 있으며 완벽한 정배열 강세장입니다. 섣부른 매도보다 수익을 극대화하세요."
    elif latest_close < ma20 and ma20 < ma60:
        return "❄️ 보수적 관망 (WAIT) / 비중 축소", "sell", f"주가가 20일선 아래로 밀린 역배열 하락 추세입니다. 바닥이 확인될 때까지 신규 매수(물타기)를 절대 자제하세요."
    elif latest_close > ma20 and ma20 < ma60:
        return "💡 단기 반등 (WATCH)", "buy", f"장기 추세는 하락이나 단기 20일선을 회복했습니다. 골든크로스가 나오는지 관찰하며 분할 매수를 준비해볼 타점입니다."
    else:
        return "⚖️ 방향성 탐색 (NEUTRAL)", "hold", "뚜렷한 추세가 없는 횡보 구간(박스권)입니다. 비중을 유지한 채 관망하세요."

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
            
            latest_price = float(closes[-1])
            latest_vol = float(volumes[-1])
            latest_ma20 = float(df['MA20'].iloc[-1])
            latest_ma60 = float(df['MA60'].iloc[-1])
            
            # AI 시그널 분석
            signal_text, signal_class, signal_reason = analyze_signal(latest_price, latest_ma20, latest_ma60)
            
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
                'signal_reason': signal_reason
            }
        except Exception as e:
            print(f"Error processing {name}: {e}")

    # 데이터 추출
    h_data = data.get('SK하이닉스', {})
    s_data = data.get('삼성중공업', {})
    
    hynix_json = json.dumps(h_data)
    shi_json = json.dumps(s_data)

    # HTML 렌더
