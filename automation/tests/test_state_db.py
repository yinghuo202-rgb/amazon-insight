from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from store_ops.db import StateDb


class StateDbTests(unittest.TestCase):
    def test_initializes_purchase_order_review_event_log(self):
        with TemporaryDirectory() as directory:
            database = StateDb(Path(directory) / "operations.sqlite3")
            try:
                database.init()
                table = database.conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_order_review_events'"
                ).fetchone()
                self.assertIsNotNone(table)
            finally:
                database.close()


if __name__ == "__main__":
    unittest.main()
