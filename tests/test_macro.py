"""Pure tests: no UAC prompt, GUI, keyboard hooks, mouse movement or game access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace
import threading

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


class MouseInputTests(unittest.TestCase):
    def backend(self, interrupt_on=None, release_error=False):
        events = []
        backend = macro.WindowsInput.__new__(macro.WindowsInput)
        direct = SimpleNamespace(FAILSAFE=True)
        direct.moveTo = lambda x, y: events.append(('move', x, y))
        def down(**kwargs):
            self.assertEqual(kwargs, dict(button='left', _pause=False))
            self.assertTrue(direct.FAILSAFE)
            events.append(('down',))
        def up(**kwargs):
            self.assertEqual(kwargs, dict(button='left', _pause=False))
            events.append(('up',))
            self.assertFalse(direct.FAILSAFE)
            if release_error:
                raise RuntimeError('release failed')
        direct.mouseDown, direct.mouseUp = down, up
        backend.direct = direct
        backend.check = lambda: None
        def wait(seconds):
            events.append(('wait', seconds))
            if seconds == interrupt_on:
                raise macro.Interrupted('F8, corner or focus changed')
        backend.wait = wait
        return backend, events

    def test_click_sends_separate_down_hold_up_twice(self):
        backend, events = self.backend()
        backend.click((300, 1050), repeat=True)
        self.assertEqual(events, [('move', 300, 1050), ('wait', macro.MOUSE_SETTLE_SECONDS),
            ('down',), ('wait', macro.MOUSE_HOLD_SECONDS), ('up',), ('wait', macro.MOUSE_CLICK_GAP_SECONDS),
            ('down',), ('wait', macro.MOUSE_HOLD_SECONDS), ('up',), ('wait', macro.MOUSE_CLICK_GAP_SECONDS)])
        self.assertTrue(backend.direct.FAILSAFE)

    def test_single_click_uses_one_down_up_pair(self):
        backend, events = self.backend()
        backend.click((960, 570))
        self.assertEqual(events.count(('down',)), 1)
        self.assertEqual(events.count(('up',)), 1)

    def test_interrupt_during_hold_releases_without_second_click(self):
        backend, events = self.backend(interrupt_on=macro.MOUSE_HOLD_SECONDS)
        with self.assertRaises(macro.Interrupted):
            backend.click((300, 1050), repeat=True)
        self.assertEqual(events[-1], ('up',))
        self.assertEqual(events.count(('down',)), 1)
        self.assertTrue(backend.direct.FAILSAFE)

    def test_interrupt_before_press_sends_no_click(self):
        backend, events = self.backend(interrupt_on=macro.MOUSE_SETTLE_SECONDS)
        with self.assertRaises(macro.Interrupted):
            backend.click((300, 1050))
        self.assertNotIn(('down',), events)
        self.assertNotIn(('up',), events)

    def test_release_error_still_restores_fail_safe(self):
        backend, events = self.backend(release_error=True)
        with self.assertRaisesRegex(RuntimeError, 'release failed'):
            backend.click((300, 1050))
        self.assertTrue(backend.direct.FAILSAFE)
        self.assertEqual(events.count(('down',)), 1)

    def test_command_is_written_once_before_wait_and_send_click(self):
        backend = macro.WindowsInput.__new__(macro.WindowsInput)
        events = []
        backend.click = lambda point, repeat=False: events.append(('click', point, repeat))
        backend.check = lambda: None
        backend.gui = SimpleNamespace(write=lambda text, interval: events.append(('write', text, interval)))
        backend.wait = lambda seconds: events.append(('wait', seconds))
        command = '@itemEnchant 121660106 1 9'
        backend.send(command)
        self.assertEqual(events, [('click', macro.CHAT_POINT, True), ('write', command, 0),
                                 ('wait', 0.8), ('click', macro.SEND_POINT, True)])

    def test_stop_during_text_settle_does_not_click_send(self):
        backend = macro.WindowsInput.__new__(macro.WindowsInput)
        backend.click, backend.check = Mock(), Mock()
        backend.gui = SimpleNamespace(write=Mock())
        backend.wait = Mock(side_effect=macro.Interrupted('stop during settle'))
        with self.assertRaises(macro.Interrupted):
            backend.send('@item 110120101 1')
        backend.gui.write.assert_called_once_with('@item 110120101 1', interval=0)
        backend.click.assert_called_once_with(macro.CHAT_POINT, repeat=True)

    def test_gui_start_needs_no_ready_variable_for_full_or_resume(self):
        for mode, next_index in [('all', 0), ('half', 0), ('half', 2)]:
            with self.subTest(mode=mode, next_index=next_index), tempfile.TemporaryDirectory() as folder:
                app = macro.MacroApp.__new__(macro.MacroApp)
                app.items = [('110120101', '0')] * 4
                app.progress = macro.Progress(app.items, folder)
                app.progress.state['next_index'] = next_index
                app.running = False
                app.storage_error = False
                app.stop = threading.Event()
                app.mode = Mock(get=Mock(return_value=mode))
                app.root, app.status, app.dialog = Mock(), Mock(), Mock()
                app.refresh = Mock()
                app.hotkey = None
                backend = SimpleNamespace(gui=SimpleNamespace(size=lambda: macro.SCREEN_SIZE))
                keyboard = SimpleNamespace(add_hotkey=Mock(return_value='F8'), remove_hotkey=Mock())
                with patch.dict('sys.modules', {'keyboard': keyboard}), \
                        patch.object(macro, 'WindowsInput', return_value=backend), \
                        patch.object(macro.threading, 'Thread') as thread:
                    app.start()
                    self.assertTrue(app.running)
                    app.root.iconify.assert_called_once()
                    thread.return_value.start.assert_called_once()
                    self.assertEqual(thread.call_args.kwargs['args'],
                                     (macro.segment_end(4, next_index, mode),))
                    app.dialog.showerror.assert_not_called()
                    app.dialog.showinfo.assert_not_called()


if __name__ == '__main__':
    unittest.main()
