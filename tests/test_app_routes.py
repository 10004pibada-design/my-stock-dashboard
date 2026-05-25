import unittest
from unittest.mock import patch

import app as app_module


class AppRoutesTestCase(unittest.TestCase):
    def setUp(self):
        app_module.app.config['TESTING'] = True
        self.client = app_module.app.test_client()

    def _login_session(self):
        with self.client.session_transaction() as sess:
            sess['authenticated'] = True

    def test_health_endpoint(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['status'], 'ok')

    def test_invalid_ticker_returns_400(self):
        self._login_session()
        response = self.client.get('/api/stock/AAPL%24')
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload['success'])

    @patch.object(app_module, 'load_user_tickers', return_value={})
    @patch.object(app_module, 'fetch_stock_data')
    def test_stocks_endpoint_success_shape(self, mock_fetch_stock_data, _mock_load_user_tickers):
        mock_fetch_stock_data.return_value = {
            'ticker': '000660.KS',
            'dates': ['2026-01-01'],
            'kline': [[100.0, 110.0, 95.0, 115.0]],
            'volumes': [1000],
            'ma20': [105.0],
            'ma60': [102.0],
            'rsi': [55.0],
            'macd': {'macd': [0.1], 'signal': [0.05], 'histogram': [0.05]},
            'bollinger': {'upper': [120.0], 'middle': [105.0], 'lower': [90.0]},
            'latest_price': 110.0,
            'latest_vol': 1000,
            'change_pct': 1.23,
            'signal_text': '테스트',
            'signal_class': 'hold',
            'signal_reason': '테스트 사유',
            'signal_reasons': ['테스트'],
            'rsi_value': 55.0,
            'updated_at': '2026-01-01T00:00:00'
        }

        self._login_session()
        response = self.client.get('/api/stocks')
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertGreaterEqual(payload['count'], 1)
        self.assertIsInstance(payload['data'], dict)

    @patch.object(app_module, 'load_user_tickers', return_value={})
    @patch.object(app_module, 'fetch_stock_data')
    def test_stocks_endpoint_forwards_period(self, mock_fetch_stock_data, _mock_load_user_tickers):
        mock_fetch_stock_data.return_value = {
            'ticker': '000660.KS',
            'dates': ['2026-01-01'],
            'kline': [[100.0, 110.0, 95.0, 115.0]],
            'volumes': [1000],
            'ma20': [105.0],
            'ma60': [102.0],
            'rsi': [55.0],
            'macd': {'macd': [0.1], 'signal': [0.05], 'histogram': [0.05]},
            'bollinger': {'upper': [120.0], 'middle': [105.0], 'lower': [90.0]},
            'latest_price': 110.0,
            'latest_vol': 1000,
            'change_pct': 1.23,
            'signal_text': '테스트',
            'signal_class': 'hold',
            'signal_reason': '테스트 사유',
            'signal_reasons': ['테스트'],
            'rsi_value': 55.0,
            'updated_at': '2026-01-01T00:00:00'
        }

        self._login_session()
        response = self.client.get('/api/stocks?period=5d')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(call.args[1] == '5d' for call in mock_fetch_stock_data.call_args_list))

    def test_search_limit_validation(self):
        self._login_session()
        response = self.client.get('/api/search?q=삼성&limit=abc')
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload['success'])

    @patch.object(app_module.portfolio_manager, 'update_shares')
    def test_portfolio_put_invalid_value_returns_400(self, mock_update_shares):
        self._login_session()
        response = self.client.put(
            '/api/portfolio/holding-1',
            json={'field': 'shares', 'value': 'invalid-number'}
        )
        self.assertEqual(response.status_code, 400)
        payload = response.get_json()
        self.assertFalse(payload['success'])
        mock_update_shares.assert_not_called()

    @patch.object(app_module, 'save_user_tickers')
    @patch.object(app_module, 'load_user_tickers', return_value={})
    @patch.object(app_module, 'fetch_stock_data')
    def test_tickers_post_accepts_ticker_only(self, mock_fetch_stock_data, _mock_load_user_tickers, mock_save_user_tickers):
        mock_fetch_stock_data.return_value = {
            'ticker': '005930.KS',
            'dates': ['2026-01-01'],
            'kline': [[100.0, 110.0, 95.0, 115.0]],
            'volumes': [1000],
            'ma20': [105.0],
            'ma60': [102.0],
        }

        self._login_session()
        response = self.client.post('/api/tickers', json={'ticker': '005930'})
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])
        self.assertEqual(payload['ticker'], '005930.KS')
        self.assertEqual(payload['name'], '삼성전자')
        mock_save_user_tickers.assert_called_once()

    @patch.object(app_module, 'load_user_tickers', return_value={'기존': '005930.KS'})
    @patch.object(app_module, 'fetch_stock_data')
    def test_tickers_post_duplicate_ticker_returns_409(self, mock_fetch_stock_data, _mock_load_user_tickers):
        mock_fetch_stock_data.return_value = {'ticker': '005930.KS'}

        self._login_session()
        response = self.client.post('/api/tickers', json={'ticker': '005930.KS'})
        self.assertEqual(response.status_code, 409)
        payload = response.get_json()
        self.assertFalse(payload['success'])


if __name__ == '__main__':
    unittest.main()
