"""
포트폴리오 수익률 추적 모듈 - SQLite 버전
Render.com 등 PaaS 환경에서도 안정적으로 작동
"""

import sqlite3
import os
from datetime import datetime
from typing import Dict, List, Optional
import yfinance as yf
import json

# SQLite DB 파일 경로 (Render.com에서도 유지됨)
DB_PATH = os.path.join(os.path.dirname(__file__), 'portfolio.db')

class PortfolioManager:
    """포트폴리오 관리자 (SQLite 기반)"""
    
    def __init__(self):
        self.init_db()
    
    def init_db(self):
        """데이터베이스 초기화"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # 보유 종목 테이블
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS holdings (
                id TEXT PRIMARY KEY,
                ticker TEXT NOT NULL,
                name TEXT NOT NULL,
                shares REAL NOT NULL,
                avg_price REAL NOT NULL,
                total_invested REAL NOT NULL,
                purchase_date TEXT,
                added_at TEXT,
                updated_at TEXT
            )
        ''')
        
        # 거래 히스토리 테이블
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                action TEXT NOT NULL,
                ticker TEXT NOT NULL,
                name TEXT,
                shares REAL,
                price REAL,
                date TEXT
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def add_holding(self, ticker: str, name: str, shares: float, 
                     avg_price: float, purchase_date: str = None) -> Dict:
        """보유 종목 추가"""
        if purchase_date is None:
            purchase_date = datetime.now().strftime('%Y-%m-%d')
        
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # 이미 존재하는 종목인지 확인
        cursor.execute('SELECT * FROM holdings WHERE ticker = ?', (ticker,))
        existing = cursor.fetchone()
        
        now = datetime.now().isoformat()
        
        if existing:
            # 평균 단가 업데이트 (weighted average)
            old_shares = existing[3]
            old_avg = existing[4]
            total_shares = old_shares + shares
            total_cost = (old_shares * old_avg) + (shares * avg_price)
            new_avg = round(total_cost / total_shares, 2)
            total_invested = round(total_shares * new_avg, 2)
            
            cursor.execute('''
                UPDATE holdings 
                SET shares = ?, avg_price = ?, total_invested = ?, updated_at = ?
                WHERE ticker = ?
            ''', (total_shares, new_avg, total_invested, now, ticker))
            
            holding_id = existing[0]
        else:
            # 새 종목 추가
            holding_id = f"{ticker}_{int(datetime.now().timestamp())}"
            total_invested = round(shares * avg_price, 2)
            
            cursor.execute('''
                INSERT INTO holdings (id, ticker, name, shares, avg_price, total_invested, 
                                     purchase_date, added_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (holding_id, ticker, name, shares, avg_price, total_invested,
                  purchase_date, now, now))
        
        conn.commit()
        conn.close()
        
        return {
            'id': holding_id,
            'ticker': ticker,
            'name': name,
            'shares': float(shares),
            'avg_price': float(avg_price),
            'total_invested': total_invested,
            'purchase_date': purchase_date
        }
    
    def remove_holding(self, holding_id: str) -> bool:
        """보유 종목 삭제"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # 삭제할 종목 정보 가져오기
        cursor.execute('SELECT * FROM holdings WHERE id = ?', (holding_id,))
        holding = cursor.fetchone()
        
        if holding:
            # 히스토리에 기록
            cursor.execute('''
                INSERT INTO history (action, ticker, name, shares, price, date)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', ('SELL', holding[1], holding[2], holding[3], holding[4], 
                  datetime.now().isoformat()))
            
            # 삭제
            cursor.execute('DELETE FROM holdings WHERE id = ?', (holding_id,))
            conn.commit()
            conn.close()
            return True
        
        conn.close()
        return False
    
    def update_shares(self, holding_id: str, new_shares: float) -> Optional[Dict]:
        """보유 수량 업데이트"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('SELECT avg_price FROM holdings WHERE id = ?', (holding_id,))
        result = cursor.fetchone()
        
        if result:
            avg_price = result[0]
            total_invested = round(new_shares * avg_price, 2)
            now = datetime.now().isoformat()
            
            cursor.execute('''
                UPDATE holdings 
                SET shares = ?, total_invested = ?, updated_at = ?
                WHERE id = ?
            ''', (new_shares, total_invested, now, holding_id))
            
            conn.commit()
            conn.close()
            return self.get_holding(holding_id)
        
        conn.close()
        return None
    
    def update_avg_price(self, holding_id: str, new_avg_price: float) -> Optional[Dict]:
        """평균 단가 업데이트"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('SELECT shares FROM holdings WHERE id = ?', (holding_id,))
        result = cursor.fetchone()
        
        if result:
            shares = result[0]
            total_invested = round(shares * new_avg_price, 2)
            now = datetime.now().isoformat()
            
            cursor.execute('''
                UPDATE holdings 
                SET avg_price = ?, total_invested = ?, updated_at = ?
                WHERE id = ?
            ''', (new_avg_price, total_invested, now, holding_id))
            
            conn.commit()
            conn.close()
            return self.get_holding(holding_id)
        
        conn.close()
        return None
    
    def get_holding(self, holding_id: str) -> Optional[Dict]:
        """특정 보유 종목 조회"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, ticker, name, shares, avg_price, total_invested, 
                   purchase_date, added_at, updated_at
            FROM holdings WHERE id = ?
        ''', (holding_id,))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return {
                'id': row[0],
                'ticker': row[1],
                'name': row[2],
                'shares': row[3],
                'avg_price': row[4],
                'total_invested': row[5],
                'purchase_date': row[6],
                'added_at': row[7],
                'updated_at': row[8]
            }
        return None
    
    def get_all_holdings(self) -> List[Dict]:
        """모든 보유 종목 조회"""
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, ticker, name, shares, avg_price, total_invested, 
                   purchase_date, added_at, updated_at
            FROM holdings ORDER BY added_at DESC
        ''')
        
        rows = cursor.fetchall()
        conn.close()
        
        return [{
            'id': row[0],
            'ticker': row[1],
            'name': row[2],
            'shares': row[3],
            'avg_price': row[4],
            'total_invested': row[5],
            'purchase_date': row[6],
            'added_at': row[7],
            'updated_at': row[8]
        } for row in rows]
    
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
        holdings = self.get_all_holdings()
        
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
                'return_pct': round(return_pct, 2)
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


# 전역 포트폴리오 매니저 인스턴스
portfolio_manager = PortfolioManager()
