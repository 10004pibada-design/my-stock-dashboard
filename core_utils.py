"""
공통 유틸리티/지표 계산 모듈
"""

import re
from typing import Dict

import numpy as np
import pandas as pd


VALID_TICKER_PATTERN = re.compile(r'^[A-Z0-9.\-]{1,15}$')


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


def normalize_ticker(raw_ticker: str) -> str:
    ticker = (raw_ticker or '').strip().upper()
    if ticker.isdigit() and len(ticker) == 6:
        ticker = f"{ticker}.KS"
    return ticker


def is_valid_ticker(ticker: str) -> bool:
    return bool(VALID_TICKER_PATTERN.match(ticker))


def is_korean_market_ticker(ticker: str) -> bool:
    """한국 시장 접미사(.KS/.KQ)를 가진 티커인지 확인"""
    t = (ticker or '').upper()
    return t.endswith('.KS') or t.endswith('.KQ')


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
    if len(prices) < period + 1:
        return [None] * len(prices)

    deltas = np.diff(prices)
    gains = np.where(deltas > 0, deltas, 0)
    losses = np.where(deltas < 0, -deltas, 0)

    avg_gains = np.convolve(gains, np.ones(period)/period, mode='valid')
    avg_losses = np.convolve(losses, np.ones(period)/period, mode='valid')

    rs = avg_gains / (avg_losses + 1e-10)
    rsi = 100 - (100 / (1 + rs))

    return [None] * period + rsi.tolist()


def calculate_macd(prices, fast=12, slow=26, signal=9) -> Dict:
    """MACD (Moving Average Convergence Divergence) 계산"""
    if len(prices) < slow:
        return {
            'macd': [None] * len(prices),
            'signal': [None] * len(prices),
            'histogram': [None] * len(prices)
        }

    ema_fast = pd.Series(prices).ewm(span=fast, adjust=False).mean()
    ema_slow = pd.Series(prices).ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    histogram = macd_line - signal_line

    return {
        'macd': convert_to_native(macd_line.tolist()),
        'signal': convert_to_native(signal_line.tolist()),
        'histogram': convert_to_native(histogram.tolist())
    }


def calculate_bollinger_bands(prices, period=20, std_dev=2) -> Dict:
    """볼린저 밴드 계산"""
    if len(prices) < period:
        return {
            'upper': [None] * len(prices),
            'middle': [None] * len(prices),
            'lower': [None] * len(prices)
        }

    sma = pd.Series(prices).rolling(window=period).mean()
    std = pd.Series(prices).rolling(window=period).std()
    upper = sma + (std * std_dev)
    lower = sma - (std * std_dev)

    return {
        'upper': convert_to_native(upper.tolist()),
        'middle': convert_to_native(sma.tolist()),
        'lower': convert_to_native(lower.tolist())
    }


def analyze_signal(latest_close, ma20, ma60, rsi=None):
    """종합 매매 시그널 분석"""
    if pd.isna(ma20) or pd.isna(ma60):
        return "데이터 부족", "hold", "추세 데이터가 부족합니다.", []

    reasons = []

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

    if rsi is not None and len(rsi) > 0:
        latest_rsi = rsi[-1]
        if latest_rsi is not None and not np.isnan(latest_rsi):
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
