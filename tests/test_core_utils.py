import unittest

from core_utils import (
    clean_nan_values,
    normalize_ticker,
    is_valid_ticker,
    is_korean_market_ticker,
    calculate_rsi,
)


class CoreUtilsTestCase(unittest.TestCase):
    def test_normalize_ticker_for_korean_numeric(self):
        self.assertEqual(normalize_ticker('005930'), '005930.KS')
        self.assertEqual(normalize_ticker(' aapl '), 'AAPL')

    def test_is_valid_ticker(self):
        self.assertTrue(is_valid_ticker('AAPL'))
        self.assertTrue(is_valid_ticker('005930.KS'))
        self.assertFalse(is_valid_ticker('../etc/passwd'))
        self.assertFalse(is_valid_ticker('AAPL$'))

    def test_is_korean_market_ticker(self):
        self.assertTrue(is_korean_market_ticker('005930.KS'))
        self.assertTrue(is_korean_market_ticker('035720.kq'))
        self.assertFalse(is_korean_market_ticker('AAPL'))

    def test_clean_nan_values_nested(self):
        payload = {
            'a': float('nan'),
            'b': [1.0, float('inf'), {'x': -float('inf')}],
            'c': 'ok',
        }
        cleaned = clean_nan_values(payload)
        self.assertIsNone(cleaned['a'])
        self.assertEqual(cleaned['b'][0], 1.0)
        self.assertIsNone(cleaned['b'][1])
        self.assertIsNone(cleaned['b'][2]['x'])
        self.assertEqual(cleaned['c'], 'ok')

    def test_calculate_rsi_length(self):
        prices = [100 + i for i in range(30)]
        rsi = calculate_rsi(prices, period=14)
        self.assertEqual(len(rsi), len(prices))


if __name__ == '__main__':
    unittest.main()
