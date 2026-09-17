// Run before stylesheets to restore the user's choice before the first paint.
(()=>{
 const KEY='qa-tools-theme',valid=value=>value==='dark'?'dark':'light';
 const read=()=>{try{return valid(localStorage.getItem(KEY));}catch{return 'light';}};
 function apply(value,persist=false){
  const theme=valid(value);document.documentElement.dataset.theme=theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#0d1420':'#f5f6fa');
  document.querySelectorAll('[data-theme-choice]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.themeChoice===theme)));
  if(persist)try{localStorage.setItem(KEY,theme);}catch{/* Theme selection still works if storage is blocked. */}
 }
 apply(read());
 document.addEventListener('click',event=>{const button=event.target.closest?.('[data-theme-choice]');if(button)apply(button.dataset.themeChoice,true);});
 document.addEventListener('DOMContentLoaded',()=>apply(document.documentElement.dataset.theme));
 addEventListener('storage',event=>{if(event.key===KEY||event.key===null)apply(read());});
})();
