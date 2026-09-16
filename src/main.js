import { mountJsonTool } from './json-tool.js';
import { mountItemTool } from './items/ui.js';

document.querySelector('#app').innerHTML=`
<header class="topbar"><a class="brand" href="#home" aria-label="QA 통합 툴 홈"><span class="brand-icon">QA</span> QA 통합 툴 <span class="brand-tag">WORKSPACE</span></a><span class="local"><i></i> 선택한 파일은 이 브라우저에서만 처리됩니다</span></header>
<nav class="tool-nav" aria-label="QA 기능"><a href="#home" data-page="home">홈</a><a href="#json" data-page="json">JSON 폴더 비교</a><a href="#items" data-page="items">아이템 코드 변환</a></nav>
<main class="qa-main">
 <section id="home-view"><div class="intro"><div><div class="eyebrow">QA WORKSPACE</div><h1>QA 작업 도구</h1><p>필요한 도구를 선택하세요. 메뉴를 이동해도 입력과 결과는 유지됩니다.</p></div></div><div class="tool-cards">
  <a href="#json" class="tool-card"><h2>JSON 폴더 비교</h2><p>두 버전의 하위 폴더를 비교하고, 변경된 값과 원본 행 번호를 확인합니다.</p><span class="tool-open">파일 비교 열기 →</span></a>
  <a href="#items" class="tool-card"><h2>아이템 코드 변환</h2><p>엑셀의 아이템명과 강화수치를 9자리 코드와 강화수치로 변환합니다.</p><span class="tool-open">아이템 변환 열기 →</span></a>
 </div><p class="home-note">파일을 수정하거나 서버에 전송하지 않습니다. 새로고침하면 입력과 결과가 초기화됩니다.</p></section>
 <section id="json-view" hidden></section>
 <section id="items-view" hidden></section>
 <footer><span>QA 통합 툴 <b>1.2</b></span><span>JSON 폴더 비교 · 아이템 코드 변환</span></footer>
</main>`;
mountJsonTool();mountItemTool();
function navigate(){
 const requested=location.hash.slice(1),page=['home','json','items'].includes(requested)?requested:'home';
 for(const key of ['home','json','items'])document.getElementById(key+'-view').hidden=key!==page;
 document.querySelectorAll('.tool-nav a').forEach(a=>{if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 document.title=page==='home'?'QA 통합 툴':`${page==='json'?'JSON 폴더 비교':'아이템 코드 변환'} · QA 통합 툴`;
}
addEventListener('hashchange',navigate);navigate();
