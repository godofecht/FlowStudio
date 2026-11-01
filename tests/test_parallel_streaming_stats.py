"""Independent exact-rational oracle for native Flow parallel streaming statistics.

This is not a substitute for native Flow, HTTP, R or Python-kernel execution.
The actual compiled source is exercised by stats_smoke.flow and http_smoke.py.
"""
from __future__ import annotations

from fractions import Fraction
from pathlib import Path
import statistics
import unittest

ROOT = Path(__file__).resolve().parents[1]
LIMIT = 4096
COUNT = 1024


def samples(count: int = COUNT) -> tuple[Fraction, ...]:
    if type(count) is not int or not 0 <= count <= LIMIT:
        raise ValueError("stream work budget exceeded")
    return tuple(Fraction(1_000_000_000) +
                 Fraction((index * 37 + 19) % 251, 8)
                 for index in range(count))


def exact_summary(values: tuple[Fraction, ...]):
    if not values:
        return 0, Fraction(0), Fraction(0), None, None
    mean = sum(values) / len(values)
    m2 = sum((value - mean) ** 2 for value in values)
    return len(values), mean, m2, min(values), max(values)


def merge_exact(left, right):
    if left[0] == 0:
        return right
    if right[0] == 0:
        return left
    na, ma, m2a, mina, maxa = left
    nb, mb, m2b, minb, maxb = right
    delta = mb - ma
    return (na + nb, ma + delta * nb / (na + nb),
            m2a + m2b + delta * delta * na * nb / (na + nb),
            min(mina, minb), max(maxa, maxb))


class ParallelStreamingStatsOracle(unittest.TestCase):
    def test_1024_exact_samples_and_reference(self):
        values = samples()
        count, mean, m2, minimum, maximum = exact_summary(values)
        self.assertEqual(count, COUNT)
        self.assertEqual(minimum, 1_000_000_000)
        self.assertEqual(maximum, Fraction(1_000_000_000) + Fraction(250, 8))
        self.assertAlmostEqual(float(mean), 1_000_000_015.6422119, delta=1e-7)
        self.assertAlmostEqual(float(m2 / (count - 1)), 82.06557894918343,
                               delta=1e-8)
        self.assertAlmostEqual(statistics.variance(map(float, values)),
                               float(m2 / (count - 1)), delta=1e-8)

    def test_partition_merge_is_exactly_order_independent(self):
        values = samples()
        shards = [exact_summary(values[offset::4]) for offset in range(4)]
        balanced = merge_exact(merge_exact(shards[0], shards[1]),
                               merge_exact(shards[2], shards[3]))
        reversed_tree = merge_exact(merge_exact(shards[3], shards[1]),
                                    merge_exact(shards[2], shards[0]))
        self.assertEqual(balanced, exact_summary(values))
        self.assertEqual(reversed_tree, balanced)
        self.assertEqual(merge_exact(exact_summary(()), balanced), balanced)
        self.assertEqual(merge_exact(balanced, exact_summary(())), balanced)

    def test_singleton_and_small_merge(self):
        values = tuple(Fraction(x) for x in (1, 2, 3, 4, 9))
        merged = merge_exact(exact_summary(values[:4]),
                             exact_summary(values[4:]))
        self.assertEqual(merged, exact_summary(values))
        self.assertEqual(merged[1], Fraction(19, 5))
        self.assertEqual(merged[2] / 4, Fraction(97, 10))
        self.assertEqual(exact_summary(values[4:])[2], 0)

    def test_work_ceiling_and_checked_in_compiler_fixture(self):
        for bad in (-1, LIMIT + 1, 1.5, True):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                samples(bad)
        module = (ROOT / "src/stats.flow").read_text(encoding="utf-8")
        smoke = (ROOT / "src/stats_smoke.flow").read_text(encoding="utf-8")
        self.assertIn("export function summary_merge(", module)
        self.assertIn("summary_merge(summary_merge(a, b), c)", smoke)
        self.assertIn("FLOWSTUDIO_STREAM_STATS_V1 1024", smoke)
        self.assertIn("FLOWSTUDIO_STREAM_STATS_END", smoke)
        self.assertIn("82.06557894918343", smoke)


if __name__ == "__main__":
    unittest.main()
