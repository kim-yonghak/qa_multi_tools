# -*- coding: utf-8 -*-
"""QA 통합 툴 · 아이템 매크로 (Windows / Python 3.9+)
사이트에서 생성한 데이터가 아래 a(아이템 코드), b(강화수치)에 들어갑니다.
설치(최초 1회): py -m pip install pyautogui pydirectinput keyboard
실행: py ItemCollection_날짜.py  (필요하면 Windows 관리자 승인을 요청합니다.)
"""
import ctypes
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time

# 사이트가 숫자만 넣습니다. 중복과 입력 순서를 유지합니다.
a = """__QA_ITEM_CODES__"""
b = """__QA_ENHANCEMENTS__"""

# 원본 매크로 좌표. 기본 모니터 1920 x 1080, 게임 전체 화면 기준입니다.
SCREEN_SIZE = (1920, 1080)
PREPARE_POINT = (960, 570)
CHAT_POINT = (300, 1050)
SEND_POINT = (700, 1050)
COUNTDOWN_SECONDS = 5


def parse_data(codes, enhancements):
    ids = [v.strip() for v in codes.splitlines() if v.strip()]
    levels = [v.strip() for v in enhancements.splitlines() if v.strip()]
    if not ids or len(ids) != len(levels):
        raise ValueError('아이템 코드와 강화수치의 개수가 다르거나 데이터가 비어 있습니다.')
    if any(re.fullmatch(r'[0-9]{9}', v) is None for v in ids):
        raise ValueError('아이템 코드는 9자리 숫자여야 합니다. 사이트에서 다시 다운로드하세요.')
    if any(re.fullmatch(r'0|[1-9][0-9]*', v) is None for v in levels):
        raise ValueError('강화수치는 0 이상의 정수여야 합니다.')
    return list(zip(ids, levels))


def item_command(item):
    code, level = item
    return f'@item {code} 1' if level == '0' else f'@itemEnchant {code} 1 {level}'


def segment_end(total, next_index, mode):
    if mode not in ('all', 'half') or not 0 <= next_index <= total:
        raise ValueError('실행 범위가 올바르지 않습니다.')
    midpoint = (total + 1) // 2
    return midpoint if mode == 'half' and next_index < midpoint else total


class Progress:
    """진행 위치는 입력을 보냈다는 기록이며 게임의 지급 결과를 보장하지 않습니다."""
    def __init__(self, items, folder):
        self.total = len(items)
        self.digest = hashlib.sha256(json.dumps(items, separators=(',', ':')).encode()).hexdigest()
        self.path = Path(folder) / (self.digest + '.json')
        self.state = self.fresh()
        if self.path.exists():
            state = json.loads(self.path.read_text(encoding='utf-8'))
            n = state.get('next_index')
            skipped = state.get('skipped')
            if (state.get('version') != 1 or state.get('digest') != self.digest
                    or type(n) is not int or not 0 <= n <= self.total
                    or state.get('mode') not in ('all', 'half')
                    or type(skipped) is not int or not 0 <= skipped <= n
                    or (state.get('pending') is not None and
                        (type(state['pending']) is not int or state['pending'] != n or n >= self.total))):
                raise ValueError(f'진행 기록을 읽을 수 없습니다. 아래 파일을 확인하세요.\n{self.path}')
            self.state = state

    def fresh(self):
        return dict(version=1, digest=self.digest, next_index=0, pending=None, mode='all', skipped=0)

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        with temporary.open('w', encoding='utf-8') as file:
            json.dump(self.state, file, ensure_ascii=False)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temporary, self.path)

    def resolve_pending(self, retry):
        if self.state['pending'] is None:
            return
        if not retry:
            self.state['next_index'] += 1
            self.state['skipped'] += 1
        self.state['pending'] = None
        self.save()


class Interrupted(Exception):
    pass


def run_segment(items, progress, end, backend, report):
    """OS 입출력은 backend로 분리해서 실제 게임을 조작하지 않고 검증합니다."""
    while progress.state['next_index'] < end:
        backend.check()
        index = progress.state['next_index']
        # 입력 중 중단/강제 종료되면 이 항목은 자동 재전송하지 않습니다.
        progress.state['pending'] = index
        progress.save()
        backend.send(item_command(items[index]))
        progress.state['next_index'] = index + 1
        progress.state['pending'] = None
        progress.save()
        report(index + 1)
        backend.wait(0.5)


class WindowsInput:
    def __init__(self, stop):
        import pyautogui
        import pydirectinput
        self.gui = pyautogui
        self.direct = pydirectinput
        self.gui.FAILSAFE = True
        self.direct.FAILSAFE = True
        self.gui.PAUSE = 0.01
        self.direct.PAUSE = 0.1
        self.stop = stop
        self.target = None
        self.user32 = ctypes.windll.user32
        self.user32.GetForegroundWindow.restype = ctypes.c_void_p
        self.user32.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        self.user32.GetWindowThreadProcessId.restype = ctypes.c_ulong

    def check(self):
        if self.stop.is_set():
            raise Interrupted('중지했습니다. 채팅창에 남은 글자를 지운 후 이어서 실행하세요.')
        if tuple(self.gui.position()) == (0, 0):
            raise Interrupted('마우스가 왼쪽 위 모서리에 있어 중지했습니다.')
        if self.target and self.user32.GetForegroundWindow() != self.target:
            raise Interrupted('활성 창이 바뀌어 중지했습니다. 게임으로 돌아가서 이어서 실행하세요.')

    def wait(self, seconds):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            self.check()
            self.stop.wait(min(0.05, max(0, deadline - time.monotonic())))
        self.check()

    def capture_target(self):
        self.target = self.user32.GetForegroundWindow()
        pid = ctypes.c_ulong()
        self.user32.GetWindowThreadProcessId(self.target, ctypes.byref(pid))
        if not self.target or pid.value == os.getpid():
            raise Interrupted('게임 창을 선택하지 않았습니다. 다시 실행하고 5초 안에 게임을 선택하세요.')
        self.check()

    def click(self, point, repeat=False):
        self.check()
        self.direct.click(*point, button='left')
        if repeat:
            self.check()
            # 기존 스크립트의 click + mouseDown/mouseUp(두 번 클릭) 유지.
            self.direct.click(*point, button='left')

    def prepare(self):
        self.click(PREPARE_POINT)
        self.wait(0.1)
        self.click(PREPARE_POINT)
        self.wait(0.1)

    def send(self, command):
        self.click(CHAT_POINT, repeat=True)
        # 한 글자마다 중지/창 전환을 확인합니다. @ 입력은 PyAutoGUI를 사용합니다.
        for char in command:
            self.check()
            self.gui.write(char)
        self.wait(0.5)
        self.click(SEND_POINT, repeat=True)


def ensure_admin():
    if ctypes.windll.shell32.IsUserAnAdmin():
        return True
    # 승인 없이 권한을 얻지 않습니다. UAC를 취소하면 매크로를 실행하지 않습니다.
    from ctypes import wintypes
    execute = ctypes.windll.shell32.ShellExecuteW
    execute.argtypes = [wintypes.HWND, wintypes.LPCWSTR, wintypes.LPCWSTR,
                        wintypes.LPCWSTR, wintypes.LPCWSTR, ctypes.c_int]
    execute.restype = ctypes.c_void_p
    script = str(Path(__file__).resolve())
    result = execute(None, 'runas', sys.executable,
                     subprocess.list2cmdline([script]), str(Path(script).parent), 1)
    if not result or result <= 32:
        raise RuntimeError('관리자 실행이 취소되었거나 허용되지 않았습니다. 매크로는 실행되지 않았습니다.')
    return False


class MacroApp:
    def __init__(self, root, items, progress):
        import tkinter as tk
        from tkinter import ttk, messagebox
        self.root, self.items, self.progress = root, items, progress
        self.tk, self.ttk, self.dialog = tk, ttk, messagebox
        self.events = queue.Queue()
        self.stop = threading.Event()
        self.running = False
        self.closing = False
        self.thread = None
        self.backend = None
        self.hotkey = None
        self.storage_error = False
        self.mode = tk.StringVar(value=progress.state['mode'])
        self.ready = tk.BooleanVar(value=False)
        self.status = tk.StringVar(value='준비 조건을 확인하고 실행 방식을 선택하세요.')
        self.counter = tk.StringVar()
        self.root.title('QA 통합 툴 · 아이템 매크로')
        self.root.geometry('780x820')
        self.root.minsize(740, 800)
        root.option_add('*Font', ('맑은 고딕', 10))
        frame = ttk.Frame(root, padding=22)
        frame.pack(fill='both', expand=True)
        ttk.Label(frame, text='아이템 지급 매크로', font=('맑은 고딕', 18, 'bold')).pack(anchor='w')
        ttk.Label(frame, text=f'총 {len(items):,}개 · 입력 순서와 중복 유지 · 관리자 권한', padding=(0, 8)).pack(anchor='w')
        guide = ttk.LabelFrame(frame, text='실행 전 준비', padding=12)
        guide.pack(fill='x', pady=10)
        ttk.Label(guide, text='전체 화면, 로비 화면에서 채팅을 켜둔 상태에서 실행',
                  font=('맑은 고딕', 11, 'bold')).pack(anchor='w')
        ttk.Label(guide, text='기본 모니터 1920 × 1080 · 채팅 입력란은 비워두세요.\n'
                  '실행을 누르면 창이 최소화됩니다. 5초 안에 게임 창을 선택하세요.\n'
                  '게임 창 전환 시 중지 · F8 긴급 중지 · 마우스 왼쪽 위 모서리로 중지',
                  wraplength=630).pack(anchor='w', pady=(8, 0))
        self.ready_box = ttk.Checkbutton(frame, text='위 조건을 확인했습니다.', variable=self.ready)
        self.ready_box.pack(anchor='w', pady=(0, 8))
        self.radios = []
        for text, value in [('1. 전체 구간 실행', 'all'),
                            (f'2. 절반 실행 후 대기 ({(len(items)+1)//2}개 → 나머지 {len(items)//2}개)', 'half')]:
            radio = ttk.Radiobutton(frame, text=text, variable=self.mode, value=value)
            radio.pack(anchor='w', pady=3)
            self.radios.append(radio)
        ttk.Label(frame, textvariable=self.counter).pack(anchor='w', pady=(16, 5))
        self.bar = ttk.Progressbar(frame, maximum=len(items))
        self.bar.pack(fill='x')
        ttk.Label(frame, textvariable=self.status, wraplength=650).pack(anchor='w', pady=10)
        actions = ttk.Frame(frame)
        actions.pack(fill='x', pady=5)
        self.start_button = ttk.Button(actions, text='실행', command=self.start)
        self.start_button.pack(side='left', padx=(0, 8))
        self.stop_button = ttk.Button(actions, text='중지 (F8)', command=self.stop.set, state='disabled')
        self.stop_button.pack(side='left')
        self.reset_button = ttk.Button(actions, text='진행 초기화', command=self.reset)
        self.reset_button.pack(side='right')
        ttk.Label(frame, text='진행 위치는 이 PC에 자동 저장됩니다. 같은 데이터를 다시 열면 이어갑니다.\n'
                  '표시된 진행률은 입력 전송 기준이며, 실제 지급 여부는 게임에서 확인하세요.',
                  wraplength=650, foreground='#64748b').pack(anchor='w', pady=12)
        preview = '\n'.join(f'{i+1}.  {code}    +{level}' for i, (code, level) in enumerate(items[:5]))
        ttk.Label(frame, text='포함 데이터 (앞 5개)\n' + preview, foreground='#64748b').pack(anchor='w')
        root.protocol('WM_DELETE_WINDOW', self.close)
        self.refresh()
        root.after(100, self.poll)

    def refresh(self):
        n = self.progress.state['next_index']
        pending = self.progress.state['pending']
        skipped = self.progress.state['skipped']
        self.counter.set(f'처리 위치 {n:,} / {len(self.items):,} · 입력 전송 {n-skipped:,}개 · 사용자 건너뛰기 {skipped}개'
                         + (f' · {pending+1}번째 확인 필요' if pending is not None else ''))
        self.bar['value'] = n
        locked = self.running or n > 0 or pending is not None
        for radio in self.radios:
            radio.configure(state='disabled' if locked else 'normal')
        done = n == len(self.items)
        text = '완료' if done else ('나머지 실행' if n or pending is not None else '실행')
        self.start_button.configure(text=text, state='disabled' if self.running or done or self.storage_error else 'normal')
        self.stop_button.configure(state='normal' if self.running else 'disabled')
        self.reset_button.configure(state='disabled' if self.running or self.storage_error else 'normal')
        self.ready_box.configure(state='disabled' if self.running else 'normal')
        if done and not self.running:
            self.status.set('전체 구간 처리를 마쳤습니다. 실제 지급 결과를 게임에서 확인하세요.')

    def start(self):
        if self.running or self.storage_error:
            return
        if not self.ready.get():
            self.dialog.showinfo('실행 전 확인', '준비 조건을 확인하고 체크해 주세요.', parent=self.root)
            return
        try:
            import keyboard
            self.backend = WindowsInput(self.stop)
            if tuple(self.backend.gui.size()) != SCREEN_SIZE:
                raise ValueError(f'기본 모니터 해상도를 {SCREEN_SIZE[0]} × {SCREEN_SIZE[1]}로 맞춰주세요.\n현재 좌표는 이 해상도 기준입니다.')
            pending = self.progress.state['pending']
            if pending is not None:
                code, level = self.items[pending]
                choice = self.dialog.askyesnocancel('중단된 항목 확인',
                    f'{pending+1}번째: {code} / +{level}\n입력 도중 중단되어 지급 여부를 알 수 없습니다.\n'
                    '게임에서 지급 여부를 확인하고 채팅창의 남은 글자를 지워주세요.\n\n'
                    '예: 이 항목부터 다시 입력 (이미 지급됐다면 중복 지급 가능)\n'
                    '아니요: 이 항목을 건너뛰고 다음부터 입력\n취소: 실행하지 않음', parent=self.root)
                if choice is None:
                    return
                self.progress.resolve_pending(choice)
            if self.progress.state['next_index'] == len(self.items):
                self.refresh()
                return
            self.progress.state['mode'] = self.mode.get()
            self.progress.save()
            end = segment_end(len(self.items), self.progress.state['next_index'], self.mode.get())
            self.stop.clear()
            self.hotkey = keyboard.add_hotkey('f8', self.stop.set, suppress=False)
            self.running = True
            self.ready.set(False)
            self.refresh()
            self.status.set('5초 안에 게임 창을 선택하세요. F8로 취소할 수 있습니다.')
            self.root.iconify()
            self.thread = threading.Thread(target=self.work, args=(end,), daemon=False)
            self.thread.start()
        except Exception as error:
            if isinstance(error, OSError):
                self.storage_error = True
            self.remove_hotkey()
            self.running = False
            self.root.deiconify()
            self.refresh()
            self.dialog.showerror('실행할 수 없습니다', str(error), parent=self.root)

    def work(self, end):
        message = ''
        storage_error = False
        try:
            for remaining in range(COUNTDOWN_SECONDS, 0, -1):
                self.events.put(('status', f'{remaining}초 후 시작 · 게임 창을 선택하세요.'))
                self.backend.wait(1)
            self.backend.capture_target()
            self.backend.prepare()
            run_segment(self.items, self.progress, end, self.backend,
                        lambda n: self.events.put(('progress', n)))
            message = ('앞 절반 입력을 마쳤습니다. 게임을 준비한 뒤 [나머지 실행]을 누르세요.'
                       if end < len(self.items) else '전체 구간 입력을 마쳤습니다. 게임에서 지급 결과를 확인하세요.')
        except Interrupted as error:
            message = str(error)
        except OSError as error:
            # 진행 저장 실패 후에는 메모리의 위치를 신뢰해 계속하지 않습니다.
            message = f'파일/시스템 오류로 중지했습니다: {error}\n창을 닫고 진행 기록을 확인한 후 다시 실행하세요.'
            storage_error = True
        except Exception as error:
            message = f'입력을 중지했습니다: {type(error).__name__}: {error}'
        finally:
            self.events.put(('finished', (message, storage_error)))

    def poll(self):
        try:
            while True:
                kind, value = self.events.get_nowait()
                if kind == 'status':
                    self.status.set(value)
                elif kind == 'progress':
                    self.refresh()
                    self.status.set(f'{value}번째 입력 전송 · F8로 중지')
                elif kind == 'finished':
                    self.running = False
                    self.storage_error = value[1]
                    self.remove_hotkey()
                    self.refresh()
                    self.status.set(value[0])
                    if self.closing:
                        self.root.destroy()
                        return
                    self.root.deiconify()
                    self.root.lift()
        except queue.Empty:
            pass
        self.root.after(100, self.poll)

    def remove_hotkey(self):
        if self.hotkey is not None:
            import keyboard
            keyboard.remove_hotkey(self.hotkey)
            self.hotkey = None

    def reset(self):
        if self.running:
            return
        if not self.dialog.askyesno('진행 초기화', '처음부터 다시 실행할 수 있도록 진행 기록을 초기화할까요?\n이미 지급된 아이템은 회수되지 않습니다.', parent=self.root):
            return
        old_state = self.progress.state
        self.progress.state = self.progress.fresh()
        try:
            self.progress.save()
        except OSError as error:
            self.progress.state = old_state
            self.dialog.showerror('저장 실패', str(error), parent=self.root)
            return
        self.mode.set('all')
        self.ready.set(False)
        self.status.set('진행을 초기화했습니다. 실행 방식을 다시 선택하세요.')
        self.refresh()

    def close(self):
        if self.running:
            self.closing = True
            self.stop.set()
            self.status.set('입력을 중지하고 진행 상태를 저장한 뒤 종료합니다…')
        else:
            self.root.destroy()


def main():
    import tkinter as tk
    from tkinter import messagebox
    root = tk.Tk()
    root.withdraw()
    mutex = None
    try:
        if sys.platform != 'win32':
            raise RuntimeError('이 매크로는 Windows에서 실행하세요.')
        items = parse_data(a, b)
        if not ensure_admin():
            root.destroy()
            return
        # 중복 창/서로 다른 작업의 매크로를 동시에 실행하지 않습니다.
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_wchar_p]
        kernel.CreateMutexW.restype = ctypes.c_void_p
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        mutex = kernel.CreateMutexW(None, False, 'Local\\QAToolsItemMacro')
        if not mutex:
            raise ctypes.WinError(ctypes.get_last_error())
        if ctypes.get_last_error() == 183:
            raise RuntimeError('이미 아이템 매크로 창이 열려 있습니다. 기존 창을 사용하거나 닫아주세요.')
        missing = []
        import importlib
        for name in ('pyautogui', 'pydirectinput', 'keyboard'):
            try:
                importlib.import_module(name)
            except ImportError:
                missing.append(name)
        if missing:
            raise RuntimeError('필요한 패키지: ' + ', '.join(missing) + '\n\nPowerShell에서 아래 명령을 실행하세요.\n'
                               'py -m pip install pyautogui pydirectinput keyboard\n\n현재 Python: ' + sys.executable)
        progress = Progress(items, Path(os.environ.get('LOCALAPPDATA', str(Path.home()))) / 'QATools' / 'ItemMacro')
        MacroApp(root, items, progress)
        root.deiconify()
        root.mainloop()
    except Exception as error:
        messagebox.showerror('QA 아이템 매크로', str(error), parent=root)
        root.destroy()
    finally:
        if mutex:
            kernel.CloseHandle(mutex)


if __name__ == '__main__':
    # 물리 픽셀 좌표를 사용합니다. Tk 창을 만들기 전에 DPI 설정합니다.
    if sys.platform == 'win32':
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            pass
    main()
