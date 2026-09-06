/* বাংলা সংবাদ — একই পেজে আরও পড়ুন + একাধিক ছবি */
(function(){
  const SHEET_URL='https://docs.google.com/spreadsheets/d/1gX73WskIs3D-8IcyPJ24NT0xn1KIEJSjMXOF9nCQqTg/gviz/tq?tqx=out:json&sheet=Bangla%20News';
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=s=>String(s??'').toLowerCase().trim();
  let newsPromise=null;

  function parse(text){
    const a=text.indexOf('{'), b=text.lastIndexOf('}')+1;
    const rows=JSON.parse(text.slice(a,b)).table.rows||[];
    return rows.map((r,i)=>{
      const c=r.c||[], v=n=>c[n]&&c[n].v!=null?String(c[n].v):'';
      return {id:v(0)||(i+1)+'',category:v(1),title:v(2),text:v(3),image:v(4),date:v(5),image2:v(6),image3:v(7),video:v(8)};
    });
  }
  function loadNews(){
    if(!newsPromise) newsPromise=fetch(SHEET_URL+'&_='+Date.now(),{cache:'no-store'}).then(r=>r.text()).then(parse);
    return newsPromise;
  }
  function imageUrl(url){
    const raw=String(url||'').trim();
    if(!raw) return '';
    // Google Drive Share link দিলে ID খোঁজা/পরিবর্তন করা লাগবে না; সাইট নিজেই image URL বানাবে।
    const m=raw.match(/drive\.google\.com\/(?:file\/d\/|open\?(?:[^#]*&)?id=|uc\?(?:[^#]*&)?id=)([A-Za-z0-9_-]+)/i);
    return m ? `https://drive.google.com/thumbnail?id=${m[1]}&sz=w2000` : raw;
  }
  function imageHtml(url,title,n){
    const src=imageUrl(url);
    if(!src) return '';
    return `<figure class="reader-inline-media"><img loading="lazy" src="${esc(src)}" alt="${esc(title)} — ছবি ${n}" onerror="this.closest('figure').remove()"><figcaption>ছবি ${n}</figcaption></figure>`;
  }
  function splitForImage(text){
    const clean=String(text||'').trim();
    if(!clean) return {before:'',after:''};
    const width=Math.max(320, document.documentElement.clientWidth||720);
    // আনুমানিক ৩০–৪০টি ভিজ্যুয়াল লাইনের পর ছবি বসানো। মোবাইলে ছোট, ডেস্কটপে বড় টেক্সট ব্লক।
    const charsPerLine=Math.max(32, Math.floor(width/9));
    const target=Math.min(clean.length-1, Math.max(900, Math.min(3000, charsPerLine*35)));
    let cut=clean.indexOf('\n',target);
    if(cut<0 || cut>target+700) cut=clean.indexOf(' ',target);
    if(cut<0) cut=target;
    return {before:clean.slice(0,cut).trim(),after:clean.slice(cut).trim()};
  }
  function paragraphs(text){
    return String(text||'').split(/\n\s*\n|\n/).map(x=>x.trim()).filter(Boolean).map(x=>`<p>${esc(x)}</p>`).join('');
  }
  function homePreviewCut(text){
    const clean=String(text||'').trim();
    if(!clean) return {preview:'',remaining:''};
    const width=Math.max(320, document.documentElement.clientWidth||720);
    // হোমপেজে প্রায় ৩টি ভিজ্যুয়াল লাইনের পরের অংশই বিস্তারিত হিসেবে দেখানো হবে।
    const charsPerLine=Math.max(28, Math.floor(width/9));
    const target=Math.min(clean.length, Math.max(180, Math.min(600, charsPerLine*3)));
    if(clean.length<=target) return {preview:clean,remaining:''};
    let cut=clean.indexOf(' ',target);
    if(cut<0 || cut>target+220) cut=target;
    return {preview:clean.slice(0,cut).trim(),remaining:clean.slice(cut).trim()};
  }
  function detailMarkup(n, remainingOnly=false){
    const full=String(n.text||'').trim();
    const textForDetail = remainingOnly ? homePreviewCut(full).remaining : full;
    return paragraphs(textForDetail) || '<p>এই সংবাদের বাকি অংশ নেই।</p>';
  }
  function style(){
    if(document.getElementById('same-page-reader-style')) return;
    const s=document.createElement('style'); s.id='same-page-reader-style'; s.textContent=`
      .same-page-detail{margin-top:18px;padding-top:18px;border-top:2px solid #eee;color:#333;font-size:16px;line-height:1.85}
      .same-page-detail p{margin:0 0 16px}
      .reader-inline-media{margin:28px 0;text-align:center;background:#fff}
      .reader-inline-media img{display:block;width:100%;height:auto;max-height:620px;object-fit:contain;border-radius:8px}
      .reader-inline-media figcaption{font-size:12px;color:#777;margin-top:6px}
      .reader-detail-loading{padding:15px 0;color:#777;text-align:center}
      .news-card .news-image img,.news-image-top img{background:#f1f1f1}
    `; document.head.appendChild(s);
  }
  function getId(link){return link.getAttribute('data-news-id')||((link.getAttribute('href')||'').match(/id=([^&#]+)/)||[])[1]||'';}
  function ensurePrimaryImage(card,n){
    if(!n.image || card.querySelector('.news-image img,.news-image-top img,.news-primary-image')) return;
    const title=card.querySelector('h2,h3');
    const wrap=document.createElement('div'); wrap.className='news-primary-image';
    wrap.innerHTML=`<img loading="lazy" src="${esc(imageUrl(n.image))}" alt="${esc(n.title)}" style="width:100%;height:auto;max-height:520px;object-fit:contain;border-radius:8px" onerror="this.closest('.news-primary-image').remove()">`;
    if(title) title.parentNode.insertBefore(wrap,title); else card.insertBefore(wrap,card.firstChild);
  }
  async function openDetail(link){
    const id=getId(link); if(!id) return;
    const card=link.closest('.news-card,.vertical-news-block,.news-item')||link.parentElement;
    if(!card) return;
    if(card.querySelector('.same-page-detail')){card.querySelector('.same-page-detail').scrollIntoView({behavior:'smooth',block:'nearest'});return;}
    link.removeAttribute('href'); link.setAttribute('aria-expanded','true'); link.classList.add('is-open');
    const box=document.createElement('div'); box.className='same-page-detail';
    box.innerHTML='<div class="reader-detail-loading">বিস্তারিত সংবাদ লোড হচ্ছে...</div>';
    link.insertAdjacentElement('afterend',box);
    // বাকি সংবাদ খুলে গেলে ‘আরও পড়ুন’ বাটনটি আর দেখানো হবে না।
    link.remove();
    try{
      const list=await loadNews(); const n=list.find(x=>String(x.id)===String(id));
      if(!n){box.innerHTML='<p>দুঃখিত, খবরটির বিস্তারিত পাওয়া যায়নি।</p>';return;}
      // একই নিউজে শুধু প্রথম (Image 1) ছবিটিই থাকবে।
      // 'আরও পড়ুন' চাপার পর নতুন করে আর কোনো ছবি যোগ করা হবে না।
      const allImages = Array.from(card.querySelectorAll('.news-image-wrap, .news-image-top, .news-primary-image, .news-image, .news-image-wrap img'));
      const primaryWrap = card.querySelector('.news-image-wrap, .news-image-top, .news-primary-image, .news-image');
      if(primaryWrap){
        const keepImg = primaryWrap.querySelector('img');
        card.querySelectorAll('img').forEach(img=>{
          if(img !== keepImg && !img.closest('.site-header,.brand-header')) img.closest('figure,.news-primary-image,.news-image-wrap,.news-image-top,.news-image')?.remove();
        });
      } else {
        ensurePrimaryImage(card,n);
      }
      const isHomeCard = !!card.querySelector('.home-summary');
      box.innerHTML=detailMarkup(n,isHomeCard);
      box.scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(e){box.innerHTML='<p>খবরের বিস্তারিত লোড করতে সমস্যা হয়েছে। ইন্টারনেট সংযোগ পরীক্ষা করুন।</p>';}
  }
  function enrichCards(list){
    const map=new Map(list.map(n=>[String(n.id),n]));
    document.querySelectorAll('.news-card,.vertical-news-block,.news-item').forEach(card=>{
      const link=card.querySelector('.read-more-btn[data-news-id]');
      if(!link) return;
      const n=map.get(String(getId(link)));
      if(!n || !n.image) return;
      const existing=card.querySelector('.news-image img,.news-image-top img,.news-image-wrap img,.news-primary-image img');
      if(existing){
        existing.src=imageUrl(n.image); existing.alt=n.title;
        existing.onerror=function(){this.closest('.news-image,.news-image-top,.news-primary-image')?.remove();};
      } else { ensurePrimaryImage(card,n); }
    });
  }
  function bind(){
    style();
    loadNews().then(enrichCards).catch(()=>{});
    document.addEventListener('click',e=>{
      const link=e.target.closest('.read-more-btn,[data-news-id]');
      if(!link) return;
      if(!link.matches('.read-more-btn')) return;
      // যেসব ‘আরও পড়ুন’ লিংক details.html-এ পাঠানোর জন্য নির্ধারিত, সেগুলো স্বাভাবিকভাবেই খুলবে।
      const href=link.getAttribute('href')||'';
      if(link.classList.contains('breaking-detail-btn') || /(?:^|\/)details\.html(?:[?#]|$)/i.test(href)) return;
      e.preventDefault(); openDetail(link);
    });
    // ডুপ্লিকেট একই নিউজের আরও পড়ুন বাটন থাকলে প্রথমটি রেখে বাকিগুলো সরিয়ে দিই।
    const clean=()=>{
      document.querySelectorAll('.news-card,.vertical-news-block,.news-item').forEach(card=>{
        const seen=new Set();
        card.querySelectorAll('.read-more-btn').forEach(a=>{const id=getId(a);if(id&&seen.has(id))a.remove();else if(id)seen.add(id);});
      });
      if(newsPromise) newsPromise.then(enrichCards).catch(()=>{});
    };
    new MutationObserver(clean).observe(document.body,{childList:true,subtree:true}); clean();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',bind); else bind();
})();
