"""Pure tests: no UAC prompt, GUI, keyboard hooks, mouse movement or game access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

path = Path(__file__).resolve().parents[1] / 'src/items/macro-template.py'
spec = importlib.util.spec_from_file_location('macro', path)
macro = importlib.util.module_from_spec(spec)
spec.loader.exec_module(macro)


class FakeInput:
    def __init__(self, stop_at=None, stop_after=None):
        self.commands = []
        self.stop_at = stop_at
        self.stop_after = stop_after

    def check(self):
        if self.stop_at == len(self.commands):
            raise macro.Interrupted('stop before sending')

    def send(self, command):
        self.commands.append(command)
        if self.stop_after == len(self.commands):
            raise macro.Interrupted('uncertain after sending')

    def wait(self, seconds):
        pass


class MacroTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.items = [('112220101', '0'), ('112220101', '0'), ('110120101', '9'),
                      ('111030101', '12'), ('112170170', '0')]
        self.progress = macro.Progress(self.items, self.tmp.name)

    def run_to(self, end, backend=None):
        backend = backend or FakeInput()
        macro.run_segment(self.items, self.progress, end, backend, lambda _: None)
        return backend.commands

    def test_parse_trailing_blanks_duplicates_and_zero(self):
        self.assertEqual(macro.parse_data('112220101\n112220101\n', '0\n0\n'), self.items[:2])

    def test_invalid_data(self):
        for a, b in [('', ''), ('110120101\n110120101', '9'), ('101', '9'),
                     ('110120101', '-1'), ('110120101', '1.5'), ('110120101', '9\n0')]:
            with self.subTest(a=a,b=b), self.assertRaises(ValueError):
                macro.parse_data(a, b)

    def test_commands_zero_and_enchanted(self):
        self.assertEqual(macro.item_command(self.items[0]), '@item 112220101 1')
        self.assertEqual(macro.item_command(self.items[2]), '@itemEnchant 110120101 1 9')

    def test_all_including_duplicates(self):
        commands = self.run_to(5)
        self.assertEqual(commands, list(map(macro.item_command, self.items)))
        self.assertEqual(self.progress.state['next_index'], 5)
        self.assertIsNone(self.progress.state['pending'])

    def test_odd_halves_resume_after_reopening(self):
        self.progress.state['mode'] = 'half'
        end = macro.segment_end(5, 0, 'half')
        self.assertEqual(end, 3)
        first = self.run_to(end)
        self.progress = macro.Progress(self.items, self.tmp.name)
        self.assertEqual(self.progress.state['mode'], 'half')
        end = macro.segment_end(5, self.progress.state['next_index'], 'half')
        self.assertEqual(end, 5)
        second = self.run_to(end)
        self.assertEqual(first + second, list(map(macro.item_command, self.items)))

    def test_even_halves_and_single_item(self):
        self.assertEqual(macro.segment_end(238, 0, 'half'), 119)
        self.assertEqual(macro.segment_end(238, 118, 'half'), 119)
        self.assertEqual(macro.segment_end(238, 119, 'half'), 238)
        self.assertEqual(macro.segment_end(1, 0, 'half'), 1)
        self.assertEqual(macro.segment_end(238, 0, 'all'), 238)

    def test_invalid_segment(self):
        for total, start, mode in [(5, 6, 'all'), (5, -1, 'half'), (5, 0, 'other')]:
            with self.assertRaises(ValueError):
                macro.segment_end(total, start, mode)

    def test_stop_before_first_input_does_not_mark_pending(self):
        with self.assertRaises(macro.Interrupted):
            self.run_to(5, FakeInput(stop_at=0))
        self.assertEqual(self.progress.state['next_index'], 0)
        self.assertIsNone(self.progress.state['pending'])

    def test_stop_between_items_resumes_without_repeating(self):
        backend = FakeInput(stop_at=2)
        with self.assertRaises(macro.Interrupted):
            self.run_to(5, backend)
        self.progress = macro.Progress(self.items, self.tmp.name)
        self.assertEqual(self.progress.state['next_index'], 2)
        rest = self.run_to(5)
        self.assertEqual(backend.commands + rest, list(map(macro.item_command, self.items)))

    def test_uncertain_item_stays_pending_after_reopening(self):
        with self.assertRaises(macro.Interrupted):
            self.run_to(5, FakeInput(stop_after=2))
        restored = macro.Progress(self.items, self.tmp.name)
        self.assertEqual(restored.state['next_index'], 1)
        self.assertEqual(restored.state['pending'], 1)

    def test_retry_uncertain_item(self):
        with self.assertRaises(macro.Interrupted):
            self.run_to(5, FakeInput(stop_after=2))
        self.progress.resolve_pending(True)
        self.assertEqual(self.progress.state['next_index'], 1)
        self.assertIsNone(self.progress.state['pending'])
        self.assertEqual(self.run_to(5), list(map(macro.item_command, self.items[1:])))

    def test_skip_uncertain_item_is_explicit_and_counted(self):
        with self.assertRaises(macro.Interrupted):
            self.run_to(5, FakeInput(stop_after=2))
        self.progress.resolve_pending(False)
        self.assertEqual(self.progress.state['next_index'], 2)
        self.assertEqual(self.progress.state['skipped'], 1)
        self.assertEqual(self.run_to(5), list(map(macro.item_command, self.items[2:])))

    def test_save_failure_before_sending_emits_nothing(self):
        def broken():
            raise OSError('disk full')
        self.progress.save = broken
        backend = FakeInput()
        with self.assertRaises(OSError):
            self.run_to(5, backend)
        self.assertEqual(backend.commands, [])

    def test_save_failure_after_sending_preserves_pending_on_disk(self):
        original = self.progress.save
        calls = []
        def broken():
            calls.append(1)
            if len(calls) == 2:
                raise OSError('disk full')
            original()
        self.progress.save = broken
        with self.assertRaises(OSError):
            self.run_to(5)
        restored = macro.Progress(self.items, self.tmp.name)
        self.assertEqual(restored.state['pending'], 0)
        self.assertEqual(restored.state['next_index'], 0)

    def test_different_order_or_enhancement_gets_separate_progress(self):
        self.run_to(3)
        other = macro.Progress(list(reversed(self.items)), self.tmp.name)
        self.assertNotEqual(self.progress.path, other.path)
        self.assertEqual(other.state['next_index'], 0)

    def test_completed_run_does_not_replay(self):
        self.run_to(5)
        self.assertEqual(self.run_to(5), [])

    def test_invalid_progress_is_not_silently_reset(self):
        self.progress.save()
        state = self.progress.state.copy()
        for change in [{'next_index': -1}, {'next_index': 6}, {'pending': 3}, {'skipped': 1}, {'mode': 'x'}]:
            with self.subTest(change=change):
                self.progress.path.write_text(json.dumps(dict(state, **change)))
                with self.assertRaises(ValueError):
                    macro.Progress(self.items, self.tmp.name)


if __name__ == '__main__':
    unittest.main()
