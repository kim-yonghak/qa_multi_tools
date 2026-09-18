import { mountJsonTool } from './json-tool.js';
import { mountItemTool } from './items/ui.js';
import { mountDropCompare } from './drop/compare-ui.js';
import { mountDropTool } from './drop/ui.js';

document.querySelector('#app').innerHTML=`
<header class="topbar"><a class="brand" href="#home" aria-label="QA 통합 툴 홈"><span class="brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="23" height="23" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"/></svg></span> QA 통합 툴 <span class="brand-tag">WORKSPACE</span></a><div class="topbar-actions"><span class="local"><i></i> QA 데이터 조회 · 비교 · 변환</span><div class="theme-switch" role="group" aria-label="화면 테마"><button type="button" data-theme-choice="light" aria-pressed="true">화이트</button><button type="button" data-theme-choice="dark" aria-pressed="false">다크</button></div></div></header>
<nav class="tool-nav" aria-label="QA 기능"><a href="#home" data-page="home">홈</a><a href="#json" data-page="json">JSON 폴더 비교</a><a href="#items" data-page="items">아이템 코드 변환</a><a href="#drop" data-page="drop">드랍 테이블 검수</a><a href="#dropcompare" data-page="dropcompare">드랍 변경 비교</a></nav>
<main class="qa-main">
 <section id="home-view"><div class="intro"><div><div class="eyebrow">QA WORKSPACE</div><h1>QA 작업 도구</h1><div class="release-credit"><span>v1.4.10</span><span>개발자 <strong>zeloso97/김용학</strong></span></div><p>필요한 도구를 선택하세요. 메뉴를 이동해도 입력과 결과는 유지됩니다.</p></div></div><div class="tool-cards">
  <a href="#json" class="tool-card"><h2>JSON 폴더 비교</h2><p>두 버전의 하위 폴더를 비교하고, 변경된 값과 원본 행 번호를 확인합니다.</p><span class="tool-open">파일 비교 열기 →</span></a>
  <a href="#items" class="tool-card"><h2>아이템 코드 변환</h2><p>엑셀의 아이템명과 강화수치를 9자리 코드와 강화수치로 변환합니다.</p><span class="tool-open">아이템 변환 열기 →</span></a>
  <a href="#drop" class="tool-card"><h2>드랍 테이블 검수</h2><p>몬스터 이름이나 ID로 아이템과 드랍 확률을 조회하고, 연결 경로와 원본 행을 확인합니다.</p><span class="tool-open">드랍 테이블 열기 →</span></a>
  <a href="#dropcompare" class="tool-card"><h2>드랍 변경 비교</h2><p>구·신버전 Drop의 변경된 몬스터를 모아, 지역·레벨·등급별 요약과 상세 변경을 확인합니다.</p><span class="tool-open">변경 비교 열기 →</span></a>
 </div><p class="home-note">JSON 비교와 아이템 변환은 브라우저에서 처리합니다. 드랍 테이블은 담당자가 서버에 등록한 공유 데이터를 사용합니다.</p></section>
 <section id="json-view" hidden></section>
 <section id="items-view" hidden></section>
 <section id="drop-view" hidden></section><section id="dropcompare-view" hidden></section>
 <footer><span>QA 통합 툴 <b>1.4.10</b> · 개발자 zeloso97/김용학</span><span>JSON 폴더 비교 · 아이템 코드 변환 · 드랍 테이블</span></footer>
</main>`;
mountJsonTool();mountItemTool();mountDropTool();mountDropCompare();
function navigate(){
 const requested=location.hash.slice(1),page=['home','json','items','drop','dropcompare'].includes(requested)?requested:'home';
 for(const key of ['home','json','items','drop','dropcompare'])document.getElementById(key+'-view').hidden=key!==page;
 document.querySelectorAll('.tool-nav a').forEach(a=>{if(a.dataset.page===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 document.title=page==='home'?'QA 통합 툴':`${page==='dropcompare'?'드랍 변경 비교':page==='json'?'JSON 폴더 비교':page==='drop'?'드랍 테이블 검수':'아이템 코드 변환'} · QA 통합 툴`;
}
addEventListener('hashchange',navigate);navigate();
