import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clacks.tower import overhead, relay


def test_relay_names_the_towers():
    assert relay("hello", hops=2) == "hello (after 2 towers)"


def test_overhead_counts_both_ways():
    assert overhead("GNU") == 7


def test_import_of_a_missing_tower():
    import clacks.sector_nine  # noqa: F401
