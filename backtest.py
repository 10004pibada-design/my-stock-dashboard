"""
백테스팅 모듈 - 매매 신호 과거 성과 검증
"""

import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
from dataclasses import dataclass

@dataclass
class Trade:
    """개별 거래 기록"""
    entry_date: str
    entry_price: float
    signal_type: str  # 'buy', 'sell', 'hold'
    exit_date: str = None
    exit_price: float = 0
    profit: float = 0
    profit_pct: float = 0
    status: str = 'open'  # 'open', 'closed'


class BacktestEngine:
    """백테스팅 엔진"""
    
    def __init__(self, initial_capital: float = 10000000):  # 1000만원 기준
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.trades: List[Trade] = []
        self.position: Trade = None
        self.equity_curve: List[Dict] = []
        
    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """기술적 지표 계산"""
        df = df.copy()
        
        # 이동평균선
        df['MA20'] = df['Close'].rolling(window=20).mean()
        df['MA60'] = df['Close'].rolling(window=60).mean()
        
        # RSI
        delta = df['Close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        df['RSI'] = 100 - (100 / (1 + rs))
        
        # MACD
        ema12 = df['Close'].ewm(span=12, adjust=False).mean()
        ema26 = df['Close'].ewm(span=26, adjust=False).mean()
        df['MACD'] = ema12 - ema26
        df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
        df['MACD_Hist'] = df['MACD'] - df['MACD_Signal']
        
        # 볼린저 밴드
        df['BB_Middle'] = df['Close'].rolling(window=20).mean()
        bb_std = df['Close'].rolling(window=20).std()
        df['BB_Upper'] = df['BB_Middle'] + (bb_std * 2)
        df['BB_Lower'] = df['BB_Middle'] - (bb_std * 2)
        
        return df.dropna()
    
    def generate_signals(self, df: pd.DataFrame) -> pd.DataFrame:
        """매매 신호 생성"""
        df = df.copy()
        df['Signal'] = 'hold'
        
        for i in range(1, len(df)):
            close = df['Close'].iloc[i]
            ma20 = df['MA20'].iloc[i]
            ma60 = df['MA60'].iloc[i]
            rsi = df['RSI'].iloc[i]
            macd = df['MACD'].iloc[i]
            macd_signal = df['MACD_Signal'].iloc[i]
            
            # 매수 신호
            buy_signal = (
                close > ma20 and ma20 > ma60 and  # 정배열
                rsi < 70 and  # 과매수 아님
                macd > macd_signal  # MACD 골든크로스
            )
            
            # 매도 신호
            sell_signal = (
                close < ma20 and  # 단기 이탈
                rsi > 70  # 과매수
            ) or (
                macd < macd_signal and  # MACD 데드크로스
                close < ma20  # 하락 추세
            )
            
            if buy_signal:
                df.loc[df.index[i], 'Signal'] = 'buy'
            elif sell_signal:
                df.loc[df.index[i], 'Signal'] = 'sell'
        
        return df
    
    def run_backtest(self, ticker: str, start_date: str, end_date: str) -> Dict:
        """백테스트 실행"""
        try:
            # 데이터 다운로드
            df = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = df.columns.droplevel(1)
            
            if df.empty or len(df) < 60:
                return {'success': False, 'error': '데이터가 충분하지 않습니다.'}
            
            # 지표 계산
            df = self.calculate_indicators(df)
            df = self.generate_signals(df)
            
            # 시뮬레이션
            self.trades = []
            self.capital = self.initial_capital
            self.equity_curve = []
            
            position = None
            
            for i in range(len(df)):
                row = df.iloc[i]
                date = df.index[i]
                signal = row['Signal']
                price = row['Close']
                
                # 포지션이 없을 때 매수 신호
                if position is None and signal == 'buy':
                    position = Trade(
                        entry_date=date.strftime('%Y-%m-%d'),
                        entry_price=price,
                        signal_type='buy'
                    )
                
                # 포지션 있을 때 매도 신호 또는 마지막 날
                elif position is not None and (signal == 'sell' or i == len(df) - 1):
                    position.exit_date = date.strftime('%Y-%m-%d')
                    position.exit_price = price
                    position.status = 'closed'
                    
                    # 수익 계산
                    position.profit = position.exit_price - position.entry_price
                    position.profit_pct = (position.profit / position.entry_price) * 100
                    
                    self.trades.append(position)
                    position = None
                
                # 자산 기록
                equity = self.calculate_equity(price, position)
                self.equity_curve.append({
                    'date': date.strftime('%Y-%m-%d'),
                    'equity': equity,
                    'price': price
                })
            
            # 결과 분석
            results = self.analyze_results()
            results['ticker'] = ticker
            results['period'] = {'start': start_date, 'end': end_date}
            results['total_days'] = len(df)
            results['equity_curve'] = self.equity_curve
            results['trades'] = [
                {
                    'entry_date': t.entry_date,
                    'entry_price': round(t.entry_price, 2),
                    'exit_date': t.exit_date,
                    'exit_price': round(t.exit_price, 2),
                    'profit': round(t.profit, 2),
                    'profit_pct': round(t.profit_pct, 2),
                    'signal': t.signal_type
                }
                for t in self.trades
            ]
            results['signal_distribution'] = self._analyze_signals(df)
            
            return {'success': True, 'data': results}
            
        except Exception as e:
            return {'success': False, 'error': str(e)}
    
    def calculate_equity(self, current_price: float, position: Trade = None) -> float:
        """현재 자산 가치 계산"""
        if position is None:
            return self.capital
        else:
            # 포지션 가치 = 현금 + 포지션 가치 (간단한 계산)
            position_value = (self.initial_capital / position.entry_price) * current_price
            return position_value
    
    def analyze_results(self) -> Dict:
        """백테스트 결과 분석"""
        if not self.trades:
            return {
                'total_trades': 0,
                'win_rate': 0,
                'avg_profit': 0,
                'total_profit': 0,
                'total_profit_pct': 0,
                'max_drawdown': 0,
                'sharpe_ratio': 0
            }
        
        total_trades = len(self.trades)
        winning_trades = [t for t in self.trades if t.profit > 0]
        losing_trades = [t for t in self.trades if t.profit <= 0]
        
        win_rate = len(winning_trades) / total_trades * 100 if total_trades > 0 else 0
        avg_profit = sum(t.profit_pct for t in self.trades) / total_trades
        total_profit = sum(t.profit for t in self.trades)
        total_profit_pct = (sum(t.profit for t in self.trades) / self.initial_capital) * 100
        
        # 최대 낙폭 계산
        max_drawdown = self._calculate_max_drawdown()
        
        # 샤프 비율 (간단한 계산)
        returns = [t.profit_pct for t in self.trades]
        sharpe_ratio = np.mean(returns) / (np.std(returns) + 1e-10) if len(returns) > 1 else 0
        
        return {
            'total_trades': total_trades,
            'winning_trades': len(winning_trades),
            'losing_trades': len(losing_trades),
            'win_rate': round(win_rate, 2),
            'avg_profit_per_trade': round(avg_profit, 2),
            'total_profit': round(total_profit, 2),
            'total_profit_pct': round(total_profit_pct, 2),
            'max_drawdown': round(max_drawdown, 2),
            'sharpe_ratio': round(sharpe_ratio, 2),
            'best_trade': max(self.trades, key=lambda x: x.profit_pct).profit_pct if self.trades else 0,
            'worst_trade': min(self.trades, key=lambda x: x.profit_pct).profit_pct if self.trades else 0
        }
    
    def _calculate_max_drawdown(self) -> float:
        """최대 낙폭 계산"""
        if not self.equity_curve:
            return 0
        
        peak = self.equity_curve[0]['equity']
        max_dd = 0
        
        for point in self.equity_curve:
            if point['equity'] > peak:
                peak = point['equity']
            dd = (peak - point['equity']) / peak * 100
            if dd > max_dd:
                max_dd = dd
        
        return max_dd
    
    def _analyze_signals(self, df: pd.DataFrame) -> Dict:
        """신호 분포 분석"""
        signal_counts = df['Signal'].value_counts().to_dict()
        return {
            'buy': int(signal_counts.get('buy', 0)),
            'sell': int(signal_counts.get('sell', 0)),
            'hold': int(signal_counts.get('hold', 0))
        }


# 전역 백테스트 엔진 인스턴스
backtest_engine = BacktestEngine()


def run_backtest(ticker: str, period: str = '1y') -> Dict:
    """간편 백테스트 실행"""
    # 기간 파싱
    end_date = datetime.now()
    
    if period == '6m':
        start_date = end_date - timedelta(days=180)
    elif period == '1y':
        start_date = end_date - timedelta(days=365)
    elif period == '2y':
        start_date = end_date - timedelta(days=730)
    elif period == '3y':
        start_date = end_date - timedelta(days=1095)
    else:
        start_date = end_date - timedelta(days=365)
    
    return backtest_engine.run_backtest(
        ticker,
        start_date.strftime('%Y-%m-%d'),
        end_date.strftime('%Y-%m-%d')
    )
