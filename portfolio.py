"""
포트폴리오 수익률 추적 모듈
보유 종목의 손익 계산 및 관리 기능
"""

import json
import os
from datetime import datetime
from typing import Dict, List, Optional
import yfinance as yf

PORTFOLIO_FILE = 'portfolio.json'

class PortfolioManager:
    """포트폴리오 관리자"""
    
    def __init__(self):
        self.portfolio = self.load_portfolio()
    
    def load_portfolio(self) -> Dict:
        """포트폴리오 데이터 로드"""
        if not os.path.exists(PORTFOLIO_FILE):
            return {'holdings': [], 'history': []}
        try:
            with open(PORTFOLIO_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading portfolio: {e}")
            return {'holdings': [], 'history': []}
    
    def save_portfolio(self):
        """포트폴리오 데이터 저장"""
        with open(PORTFOLIO_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.portfolio, f, ensure_ascii=False, indent=2)
    
    def add_holding(self, ticker: str, name: str, shares: float, 
                     avg_price: float, purchase_date: str = None) -> Dict:
        """보유 종목 추가"""
        if purchase_date is None:
            purchase_date = datetime.now().strftime('%Y-%m-%d')
        
        # 이미 존재하는 종목인지 확인
        for holding in self.portfolio['holdings']:
            if holding['ticker'] == ticker:
                # 평균 단가 업데이트 (weighted average)
                total_shares = holding['shares'] + shares
                total_cost = (holding['shares'] * holding['avg_price']) + (shares * avg_price)
                holding['shares'] = total_shares
                holding['avg_price'] = round(total_cost / total_shares, 2)
                holding['total_invested'] = round(total_shares * holding['avg_price'], 2)
                holding['updated_at'] = datetime.now().isoformat()
                self.save_portfolio()
                return holding
        
        # 새 종목 추가
        holding = {
            'id': f"{ticker}_{int(datetime.now().timestamp())}",
            'ticker': ticker,
            'name': name,
            'shares': float(shares),
            'avg_price': float(avg_price),
            'total_invested': round(shares * avg_price, 2),
            'purchase_date': purchase_date,
            'added_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }
        
        self.portfolio['holdings'].append(holding)
        self.save_portfolio()
        return holding
    
    def remove_holding(self, holding_id: str) -> bool:
        """보유 종목 삭제"""
        for i, holding in enumerate(self.portfolio['holdings']):
            if holding['id'] == holding_id:
                # 거래 히스토리에 추가
                self.portfolio['history'].append({
                    'action': 'SELL',
                    'ticker': holding['ticker'],
                    'name': holding['name'],
                    'shares': holding['shares'],
                    'price': holding['avg_price'],
                    'date': datetime.now().isoformat()
                })
                
                self.portfolio['holdings'].pop(i)
                self.save_portfolio()
                return True
        return False
    
    def update_shares(self, holding_id: str, new_shares: float) -> Optional[Dict]:
        """보유 수량 업데이트"""
        for holding in self.portfolio['holdings']:
            if holding['id'] == holding_id:
                old_shares = holding['shares']
                holding['shares'] = float(new_shares)
                holding['total_invested'] = round(new_shares * holding['avg_price'], 2)
                holding['updated_at'] = datetime.now().isoformat()
                self.save_portfolio()
                return holding
        return None
    
    def update_avg_price(self, holding_id: str, new_avg_price: float) -> Optional[Dict]:
        """평균 단가 업데이트"""
        for holding in self.portfolio['holdings']:
            if holding['id'] == holding_id:
                holding['avg_price'] = float(new_avg_price)
                holding['total_invested'] = round(holding['shares'] * new_avg_price, 2)
                holding['updated_at'] = datetime.now().isoformat()
                self.save_portfolio()
                return holding
        return None
    
    def get_current_prices(self, tickers: List[str]) -> Dict[str, float]:
        """현재가 조회"""
        prices = {}
        for ticker in tickers:
            try:
                stock = yf.Ticker(ticker)
                info = stock.info
                current_price = info.get('regularMarketPrice') or info.get('currentPrice')
                if current_price:
                    prices[ticker] = current_price
            except Exception as e:
                print(f"Error fetching price for {ticker}: {e}")
        return prices
    
    def calculate_returns(self) -> Dict:
        """수익률 계산"""
        holdings = self.portfolio['holdings']
        if not holdings:
            return {
                'holdings': [],
                'summary': {
                    'total_invested': 0,
                    'current_value': 0,
                    'total_return': 0,
                    'return_pct': 0
                }
            }
        
        # 현재가 조회
        tickers = [h['ticker'] for h in holdings]
        current_prices = self.get_current_prices(tickers)
        
        holdings_with_returns = []
        total_invested = 0
        total_current_value = 0
        
        for holding in holdings:
            ticker = holding['ticker']
            current_price = current_prices.get(ticker, holding['avg_price'])
            
            current_value = holding['shares'] * current_price
            invested = holding['total_invested']
            profit_loss = current_value - invested
            return_pct = (profit_loss / invested * 100) if invested > 0 else 0
            
            holdings_with_returns.append({
                **holding,
                'current_price': current_price,
                'current_value': round(current_value, 2),
                'profit_loss': round(profit_loss, 2),
                'return_pct': round(return_pct, 2),
                'updated_at': datetime.now().isoformat()
            })
            
            total_invested += invested
            total_current_value += current_value
        
        total_return = total_current_value - total_invested
        total_return_pct = (total_return / total_invested * 100) if total_invested > 0 else 0
        
        return {
            'holdings': holdings_with_returns,
            'summary': {
                'total_invested': round(total_invested, 2),
                'current_value': round(total_current_value, 2),
                'total_return': round(total_return, 2),
                'return_pct': round(total_return_pct, 2),
                'holding_count': len(holdings)
            },
            'last_updated': datetime.now().isoformat()
        }
    
    def get_holding(self, holding_id: str) -> Optional[Dict]:
        """특정 보유 종목 조회"""
        for holding in self.portfolio['holdings']:
            if holding['id'] == holding_id:
                return holding
        return None
    
    def get_transaction_history(self, limit: int = 50) -> List[Dict]:
        """거래 히스토리 조회"""
        return self.portfolio.get('history', [])[-limit:]
    
    def add_dividend(self, ticker: str, amount: float, date: str = None):
        """배당금 기록"""
        if date is None:
            date = datetime.now().strftime('%Y-%m-%d')
        
        if 'dividends' not in self.portfolio:
            self.portfolio['dividends'] = []
        
        self.portfolio['dividends'].append({
            'ticker': ticker,
            'amount': amount,
            'date': date,
            'recorded_at': datetime.now().isoformat()
        })
        self.save_portfolio()


# 전역 포트폴리오 매니저 인스턴스
portfolio_manager = PortfolioManager()
