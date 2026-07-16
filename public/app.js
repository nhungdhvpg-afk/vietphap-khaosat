/* =========================================================================
   VIỆT PHÁP · ĐO LƯỜNG TRẢI NGHIỆM KHÁCH HÀNG
   Toàn bộ logic: luồng khảo sát bệnh nhân + dashboard nội bộ.
   Dữ liệu lưu trong Supabase (Postgres), bảo vệ bằng Row Level Security.
   ========================================================================= */

/* ---------------- Kiểm tra cấu hình ---------------- */
if (!window.APP_CONFIG || !window.APP_CONFIG.SUPABASE_URL || window.APP_CONFIG.SUPABASE_URL.includes('DIEN-URL')) {
  document.body.innerHTML = `
    <div class="setup-warning">
      <h2>Chưa cấu hình Supabase</h2>
      <p>App chưa được kết nối tới cơ sở dữ liệu. Nếu chị đang xem trang này trên link công khai (Vercel),
      hãy vào <b>Vercel &gt; Project &gt; Settings &gt; Environment Variables</b> và kiểm tra lại hai biến
      <code>SUPABASE_URL</code> và <code>SUPABASE_ANON_KEY</code>, sau đó bấm "Redeploy".</p>
      <p>Nếu đang chạy thử trên máy, hãy sửa file <code>public/config.js</code> với thông tin dự án Supabase thật.</p>
    </div>`;
  throw new Error('Missing Supabase config');
}

const supabaseClient = window.supabase.createClient(
  window.APP_CONFIG.SUPABASE_URL,
  window.APP_CONFIG.SUPABASE_ANON_KEY
);

/* ---------------- Data model ---------------- */
const TOUCHPOINTS = [
  {id:'letan', field:'score_letan', label:'Lễ tân', note:null},
  {id:'kham', field:'score_kham', label:'Khám bệnh', note:null},
  {id:'canlamsang', field:'score_canlamsang', label:'Cận lâm sàng', note:'Xét nghiệm, X-quang'},
  {id:'nhathuoc', field:'score_nhathuoc', label:'Nhà thuốc', note:null},
];
const DEPARTMENTS = ['Nội','QL bệnh Huyết áp - Tiểu đường','Y học cổ truyền','Sản','Nhi','Ngoại','Cấp cứu'];
const FACES = ['😞','🙁','😐','🙂','😄'];
const FACE_LABELS = ['Rất tệ','Không hài lòng','Bình thường','Hài lòng','Rất hài lòng'];

// Nhãn điểm chạm có thể thay đổi theo khoa khám (riêng Khám bệnh, khoa YHCT gọi là Khám và Điều trị bệnh)
function touchpointLabel(tp, dept){
  if(tp.id === 'kham' && dept === 'Y học cổ truyền') return 'Khám và Điều trị bệnh';
  return tp.label;
}

// entry_point: đọc từ URL (?qr=letan|kham|canlamsang|nhathuoc) — chỉ dùng để phân tích, không đổi luồng 7 bước
const urlParams = new URLSearchParams(window.location.search);
const rawEntryPoint = urlParams.get('qr');
const ENTRY_POINT = ['letan','kham','canlamsang','nhathuoc'].includes(rawEntryPoint) ? rawEntryPoint : null;

let staffSession = null; // { role:'ceo' } hoặc { role:'department_head', department:'...' }
let dashFilter = { range:'today', from:null, to:null };
let dashEntries = []; // dữ liệu đã tải cho phạm vi lọc hiện tại
let pollTimer = null;

let current = { dept:null, scores:{}, nps:null, comment:'', referrals:[] };
let step = 0; // 0=dept, 1..4=touchpoints, 5=nps, 6=comment, 7=thanks

/* ---------------- View switching ---------------- */
const btnPatient = document.getElementById('btn-patient');
const btnDash = document.getElementById('btn-dash');
const viewPatient = document.getElementById('view-patient');
const viewDash = document.getElementById('view-dash');

btnPatient.onclick = ()=>{
  btnPatient.classList.add('active'); btnDash.classList.remove('active');
  viewPatient.classList.add('active'); viewDash.classList.remove('active');
};
btnDash.onclick = async ()=>{
  btnDash.classList.add('active'); btnPatient.classList.remove('active');
  viewDash.classList.add('active'); viewPatient.classList.remove('active');
  if(staffSession){
    const ok = await refreshDashboard();
    if(ok){ enterDashboard(); } else { staffSession = null; renderLoginGate(); }
  } else {
    renderLoginGate();
  }
};

/* ---------------- Staff login (Supabase Auth) ---------------- */
function renderLoginGate(){
  document.getElementById('dash-content').style.display = 'none';
  document.getElementById('dash-login').style.display = 'flex';
  document.getElementById('login-error').textContent = '';
}

document.getElementById('login-submit').onclick = async ()=>{
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-submit');
  errEl.textContent = '';
  if(!email || !password){ errEl.textContent = 'Vui lòng nhập đủ email và mật khẩu.'; return; }

  btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
  try{
    const { error: authError } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(authError){
      errEl.textContent = 'Sai email hoặc mật khẩu. Vui lòng thử lại.';
      return;
    }
    const ok = await refreshDashboard();
    if(!ok){
      errEl.textContent = 'Tài khoản chưa được gán vai trò. Vui lòng liên hệ CEO để kiểm tra bảng staff_accounts.';
      await supabaseClient.auth.signOut();
      staffSession = null;
      return;
    }
    enterDashboard();
  } finally {
    btn.disabled = false; btn.textContent = 'Đăng nhập';
  }
};

document.getElementById('login-password').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') document.getElementById('login-submit').click();
});

async function getAccessToken(){
  const { data } = await supabaseClient.auth.getSession();
  return data && data.session ? data.session.access_token : null;
}

async function logoutStaff(){
  stopPolling();
  await supabaseClient.auth.signOut();
  staffSession = null;
  document.getElementById('role-badge-slot').innerHTML = '';
  renderLoginGate();
}

function enterDashboard(){
  document.getElementById('dash-login').style.display = 'none';
  document.getElementById('dash-content').style.display = 'block';
  const badgeSlot = document.getElementById('role-badge-slot');
  const label = staffSession.role === 'ceo' ? 'CEO · Toàn phòng khám' : `Trưởng khoa · ${staffSession.department}`;
  badgeSlot.innerHTML = `<span class="role-badge">${label} <button id="logout-btn">Đăng xuất</button></span>`;
  document.getElementById('logout-btn').onclick = logoutStaff;
  document.getElementById('dash-scope-note').textContent = staffSession.role === 'ceo'
    ? 'Dành cho CEO · xem toàn bộ 7 khoa · cập nhật theo thời gian thực'
    : `Dành cho trưởng khoa ${staffSession.department} · chỉ hiển thị dữ liệu khoa này`;
  renderDashboard();
  startPolling();
}

// Không dùng Supabase Realtime (đường dữ liệu anon/authenticated hiện không ổn định) —
// thay bằng tự làm mới định kỳ để dashboard vẫn cập nhật gần thời gian thực.
function startPolling(){
  stopPolling();
  pollTimer = setInterval(()=>{ refreshDashboard(); }, 20000);
}
function stopPolling(){
  if(pollTimer){ clearInterval(pollTimer); pollTimer = null; }
}

document.getElementById('btn-refresh').onclick = ()=> refreshDashboard();

/* ---------------- Filter bar ---------------- */
document.querySelectorAll('#filter-bar .filter-chip').forEach(chip=>{
  chip.onclick = ()=>{
    document.querySelectorAll('#filter-bar .filter-chip').forEach(c=>c.classList.remove('sel'));
    chip.classList.add('sel');
    const range = chip.dataset.range;
    dashFilter.range = range;
    document.getElementById('custom-range-fields').style.display = range === 'custom' ? 'inline-flex' : 'none';
    if(range !== 'custom') refreshDashboard();
  };
});
document.getElementById('filter-apply-custom').onclick = ()=>{
  dashFilter.from = document.getElementById('filter-from').value || null;
  dashFilter.to = document.getElementById('filter-to').value || null;
  refreshDashboard();
};

function filterRangeBounds(){
  const now = new Date();
  if(dashFilter.range === 'today'){
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { from: start.toISOString(), to: null };
  }
  if(dashFilter.range === '7d'){
    return { from: new Date(now - 7*24*60*60*1000).toISOString(), to: null };
  }
  if(dashFilter.range === '30d'){
    return { from: new Date(now - 30*24*60*60*1000).toISOString(), to: null };
  }
  if(dashFilter.range === 'custom'){
    return {
      from: dashFilter.from ? new Date(dashFilter.from+'T00:00:00').toISOString() : null,
      to: dashFilter.to ? new Date(dashFilter.to+'T23:59:59').toISOString() : null,
    };
  }
  return { from: null, to: null }; // 'all'
}

/* ---------------- Load scoped data qua API server (xem api/dashboard-data.js) ---------------- */
async function refreshDashboard(){
  const token = await getAccessToken();
  if(!token) return false;

  const { from, to } = filterRangeBounds();
  const params = new URLSearchParams();
  if(from) params.set('from', from);
  if(to) params.set('to', to);

  let res;
  try{
    res = await fetch(`/api/dashboard-data?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }catch(e){
    console.error('Lỗi kết nối tới máy chủ', e);
    return staffSession ? true : false;
  }

  if(res.status === 401){
    return false;
  }
  if(!res.ok){
    console.error('Lỗi tải dữ liệu dashboard', await res.text().catch(()=>''));
    return staffSession ? true : false;
  }

  const body = await res.json();
  staffSession = { role: body.staff.role, department: body.staff.department };
  dashEntries = (body.data || []).map(row => ({
    id: row.id,
    ts: row.created_at,
    dept: row.department,
    entryPoint: row.entry_point,
    scores: {
      letan: row.score_letan,
      kham: row.score_kham,
      canlamsang: row.score_canlamsang,
      nhathuoc: row.score_nhathuoc,
    },
    nps: row.nps,
    comment: row.comment,
    referrals: row.referrals || [],
    resolved: row.resolved,
    resolvedBy: row.resolved_by,
  }));
  renderDashboard();
  return true;
}

/* ---------------- CSV export ---------------- */
function csvEscape(v){
  const s = (v===undefined||v===null) ? '' : String(v);
  return '"' + s.replace(/"/g,'""') + '"';
}
document.getElementById('btn-export-referrals').onclick = ()=>{
  const rows = [['Tên người được giới thiệu','Số điện thoại','Khách giới thiệu (khoa)','Thời gian khảo sát']];
  dashEntries.forEach(e=>{
    (e.referrals||[]).forEach(r=>{
      rows.push([r.name||'', r.phone||'', e.dept||'', new Date(e.ts).toLocaleString('vi-VN')]);
    });
  });
  if(rows.length === 1){ alert('Chưa có lượt giới thiệu nào trong khoảng thời gian đã chọn.'); return; }
  const csvContent = '﻿' + rows.map(r=>r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csvContent], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0,10);
  a.href = url; a.download = `gioi-thieu-viet-phap-${stamp}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/* ---------------- Resolve flag qua API server (xem api/resolve-flag.js) ---------------- */
async function toggleResolved(id){
  const e = dashEntries.find(x=>x.id===id);
  if(!e) return;
  const token = await getAccessToken();
  if(!token) return;
  const nextResolved = !e.resolved;

  let res;
  try{
    res = await fetch('/api/resolve-flag', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id, resolved: nextResolved }),
    });
  }catch(err){
    alert('Không cập nhật được, vui lòng kiểm tra kết nối mạng và thử lại.');
    return;
  }
  if(!res.ok){ alert('Không cập nhật được, vui lòng thử lại.'); return; }
  await refreshDashboard();
}

/* ---------------- Patient flow rendering ---------------- */
const screen = document.getElementById('screen');

function dots(total, activeIdx){
  let h = '<div class="progress-dots">';
  for(let i=0;i<total;i++) h += `<span class="${i<=activeIdx?'on':''}"></span>`;
  return h + '</div>';
}

function renderPatient(){
  if(step === 0){
    screen.innerHTML = `
      <div class="p-header">
        <div class="logo-dot"><img src="assets/logo.png" alt="Logo Việt Pháp"></div>
        <b>Phòng khám Đa khoa Việt Pháp</b>
        <span>Khảo sát nhanh — dưới 1 phút</span>
        <span class="thanks-line">Cảm ơn bạn đã điền khảo sát giúp chúng tôi nâng cao chất lượng dịch vụ.</span>
      </div>
      ${dots(6,0)}
      <div class="step-title">Hôm nay bạn khám ở khoa nào?</div>
      <div class="step-sub">Chọn khoa để chúng tôi ghi nhận đúng trải nghiệm của bạn.</div>
      <div class="chip-grid" id="dept-chips">
        ${DEPARTMENTS.map(d=>`<div class="chip" data-d="${d}">${d}</div>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn btn-primary" id="next-btn" disabled>Tiếp tục</button>
      </div>
    `;
    document.querySelectorAll('#dept-chips .chip').forEach(c=>{
      c.onclick = ()=>{
        document.querySelectorAll('#dept-chips .chip').forEach(x=>x.classList.remove('sel'));
        c.classList.add('sel');
        current.dept = c.dataset.d;
        document.getElementById('next-btn').disabled = false;
      };
    });
    document.getElementById('next-btn').onclick = ()=>{ step=1; renderPatient(); };
    return;
  }

  if(step>=1 && step<=4){
    const tp = TOUCHPOINTS[step-1];
    const label = touchpointLabel(tp, current.dept);
    const noteHtml = tp.note ? `<b style="color:var(--ink);">${tp.note}.</b> ` : '';
    screen.innerHTML = `
      ${dots(6,step)}
      <div class="step-title">Bạn có hài lòng với<br>${label} không?</div>
      <div class="step-sub">${noteHtml}Chạm vào biểu tượng phù hợp nhất.</div>
      <div class="face-row" id="face-row">
        ${FACES.map((f,i)=>`
          <div class="face-item" data-v="${i+1}">
            <div class="face-btn">${f}</div>
            <div class="face-item-label">${FACE_LABELS[i]}</div>
          </div>
        `).join('')}
      </div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="back-btn">Quay lại</button>
        <button class="btn btn-primary" id="next-btn" disabled>Tiếp tục</button>
      </div>
    `;
    document.querySelectorAll('#face-row .face-item').forEach(item=>{
      item.onclick = ()=>{
        document.querySelectorAll('#face-row .face-item').forEach(x=>{ x.classList.remove('sel'); x.querySelector('.face-btn').classList.remove('sel'); });
        item.classList.add('sel');
        item.querySelector('.face-btn').classList.add('sel');
        current.scores[tp.id] = parseInt(item.dataset.v);
        document.getElementById('next-btn').disabled = false;
      };
    });
    document.getElementById('back-btn').onclick = ()=>{ step-=1; renderPatient(); };
    document.getElementById('next-btn').onclick = ()=>{ step+=1; renderPatient(); };
    return;
  }

  if(step === 5){
    screen.innerHTML = `
      ${dots(6,5)}
      <div class="step-title">Bạn có sẵn lòng giới thiệu<br>Việt Pháp cho người thân?</div>
      <div class="step-sub">0 = Chắc chắn không · 10 = Chắc chắn có</div>
      <div class="nps-row" id="nps-row">
        ${Array.from({length:11},(_,i)=>`<div class="nps-btn" data-v="${i}">${i}</div>`).join('')}
      </div>
      <div class="nps-scale-labels"><span>0</span><span>10</span></div>
      <div class="btn-row">
        <button class="btn btn-ghost" id="back-btn">Quay lại</button>
        <button class="btn btn-primary" id="next-btn" disabled>Tiếp tục</button>
      </div>
    `;
    document.querySelectorAll('#nps-row .nps-btn').forEach(b=>{
      b.onclick = ()=>{
        document.querySelectorAll('#nps-row .nps-btn').forEach(x=>x.classList.remove('sel'));
        b.classList.add('sel');
        current.nps = parseInt(b.dataset.v);
        document.getElementById('next-btn').disabled = false;
      };
    });
    document.getElementById('back-btn').onclick = ()=>{ step-=1; renderPatient(); };
    document.getElementById('next-btn').onclick = ()=>{ step=6; renderPatient(); };
    return;
  }

  if(step === 6){
    const refRowsHtml = [1,2,3,4].map(i => `
      <div class="ref-row">
        <div class="ref-row-label">Người giới thiệu ${i} <span>(không bắt buộc)</span></div>
        <div class="ref-row-fields">
          <input type="text" class="comment ref-input ref-name" id="ref-name-${i}" placeholder="Tên">
          <input type="tel" class="comment ref-input ref-phone" id="ref-phone-${i}" placeholder="Số điện thoại">
        </div>
      </div>
    `).join('');

    screen.innerHTML = `
      ${dots(6,5)}
      <div class="step-title">Bạn muốn góp ý thêm điều gì?</div>
      <div class="step-sub">Không bắt buộc — chúng tôi đọc mọi góp ý.</div>
      <textarea class="comment" id="comment-box" placeholder="Ví dụ: phòng chờ hơi đông, mong có thêm ghế ngồi..."></textarea>

      <div class="step-sub" style="margin-bottom:12px;font-weight:700;color:var(--dark);font-size:17px;">
        Giới thiệu Việt Pháp cho người thân, bạn bè? <span style="font-weight:400;color:var(--ink-mute);">(tối đa 4 người)</span>
      </div>
      <div id="ref-rows">${refRowsHtml}</div>

      <div class="form-error" id="submit-error">Không gửi được, có thể do mất kết nối mạng. Vui lòng kiểm tra và bấm gửi lại.</div>

      <div class="btn-row">
        <button class="btn btn-ghost" id="back-btn">Quay lại</button>
        <button class="btn btn-primary" id="submit-btn">Gửi phản hồi</button>
      </div>
    `;
    document.getElementById('back-btn').onclick = ()=>{ step=5; renderPatient(); };
    document.getElementById('submit-btn').onclick = async ()=>{
      current.comment = document.getElementById('comment-box').value.trim();
      current.referrals = [1,2,3,4].map(i=>({
        name: document.getElementById(`ref-name-${i}`).value.trim(),
        phone: document.getElementById(`ref-phone-${i}`).value.trim()
      })).filter(r=>r.name || r.phone);

      const submitBtn = document.getElementById('submit-btn');
      const errEl = document.getElementById('submit-error');
      errEl.classList.remove('show');
      submitBtn.disabled = true; submitBtn.textContent = 'Đang gửi...';
      const ok = await submitEntry();
      submitBtn.disabled = false; submitBtn.textContent = 'Gửi phản hồi';
      if(!ok){ errEl.classList.add('show'); return; }
      step=7; renderPatient();
    };
    return;
  }

  if(step === 7){
    screen.innerHTML = `
      <div class="thanks">
        <div class="big-check">✓</div>
        <h3>Cảm ơn bạn!</h3>
        <p>Phản hồi của bạn giúp Việt Pháp phục vụ tốt hơn mỗi ngày.</p>
      </div>
      <div class="btn-row" style="margin-top:22px;">
        <button class="btn btn-primary" id="restart-btn">Tạo đánh giá mới</button>
      </div>
    `;
    document.getElementById('restart-btn').onclick = ()=>{
      current = { dept:null, scores:{}, nps:null, comment:'', referrals:[] };
      step = 0; renderPatient();
    };
    return;
  }
}

async function submitEntry(){
  try{
    const res = await fetch('/api/submit-survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department: current.dept,
        entryPoint: ENTRY_POINT,
        scores: current.scores,
        nps: current.nps,
        comment: current.comment || null,
        referrals: current.referrals || [],
      }),
    });
    if(!res.ok) throw new Error('submit failed: ' + res.status);
    return true;
  }catch(e){
    console.error('Lỗi gửi khảo sát', e);
    return false;
  }
}

/* ---------------- Dashboard rendering ---------------- */
function avg(nums){
  if(!nums.length) return null;
  return nums.reduce((a,b)=>a+b,0)/nums.length;
}

function renderDashboard(){
  if(!staffSession) return;
  const scoped = dashEntries;
  const total = scoped.length;
  document.getElementById('kpi-count').textContent = total;

  // NPS
  const npsVals = scoped.map(e=>e.nps).filter(v=>v!==null && v!==undefined);
  if(npsVals.length){
    const promoters = npsVals.filter(v=>v>=9).length;
    const detractors = npsVals.filter(v=>v<=6).length;
    const nps = Math.round(((promoters-detractors)/npsVals.length)*100);
    document.getElementById('kpi-nps').textContent = nps;
    document.getElementById('kpi-nps-sub').textContent = `${npsVals.length} lượt trả lời`;
  } else {
    document.getElementById('kpi-nps').textContent = '–';
    document.getElementById('kpi-nps-sub').textContent = 'Chưa có dữ liệu';
  }

  // CSAT overall
  let allScores = [];
  scoped.forEach(e=>{ Object.values(e.scores||{}).forEach(v=>{ if(v!==null && v!==undefined) allScores.push(v); }); });
  const csatAvg = avg(allScores);
  document.getElementById('kpi-csat').textContent = csatAvg ? csatAvg.toFixed(1) : '–';

  // Flags: score <=2 in any touchpoint or nps<=6 with comment
  const flags = scoped.filter(e=>{
    const low = Object.values(e.scores||{}).some(v=>v<=2);
    return low || (e.nps!==null && e.nps<=6 && e.comment);
  }).sort((a,b)=> new Date(b.ts)-new Date(a.ts));
  const activeFlags = flags.filter(e=>!e.resolved);
  document.getElementById('kpi-flags').textContent = activeFlags.length;

  // Referrals (mỗi lượt khảo sát có thể giới thiệu tối đa 4 người)
  const referrals = [];
  scoped.forEach(e=>{
    (e.referrals||[]).forEach(r=>{
      referrals.push({...r, dept:e.dept, ts:e.ts});
    });
  });
  referrals.sort((a,b)=> new Date(b.ts)-new Date(a.ts));
  document.getElementById('kpi-referrals').textContent = referrals.length;

  // Touchpoint bars
  const tpHtml = TOUCHPOINTS.map(tp=>{
    const vals = scoped.map(e=>e.scores && e.scores[tp.id]).filter(v=>v!==undefined && v!==null);
    const a = avg(vals);
    const pct = a ? (a/5*100) : 0;
    const noteSpan = tp.note ? ` <span style="color:var(--ink-mute);font-weight:400;">(${tp.note})</span>` : '';
    return `
      <div class="bar-row">
        <div class="bar-top"><span>${tp.label}${noteSpan}</span><b>${a?a.toFixed(1):'–'} / 5</b></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
      </div>
    `;
  }).join('');
  document.getElementById('touchpoint-bars').innerHTML = tpHtml || '<div class="empty-state">Chưa có dữ liệu</div>';

  // Department table (trưởng khoa chỉ thấy dòng khoa mình vì RLS đã lọc sẵn từ máy chủ)
  const deptRows = DEPARTMENTS.map(d=>{
    const rows = scoped.filter(e=>e.dept===d);
    let vals = [];
    rows.forEach(e=>{ Object.values(e.scores||{}).forEach(v=>{ if(v!==null && v!==undefined) vals.push(v); }); });
    const a = avg(vals);
    return {d, a, count: rows.length};
  }).filter(r=>r.count>0).sort((a,b)=>b.count-a.count);

  document.getElementById('dept-table').innerHTML = deptRows.length
    ? deptRows.map(r=>`<tr><td>${r.d}</td><td class="num">${r.a?r.a.toFixed(1):'–'}</td><td class="num">${r.count}</td></tr>`).join('')
    : '<tr><td colspan="3" style="text-align:center;color:var(--ink-mute);padding:14px 0;">Chưa có dữ liệu</td></tr>';

  // Flag list — chưa xử lý hiện trước, đã xử lý hiện mờ phía dưới
  const orderedFlags = [...activeFlags, ...flags.filter(e=>e.resolved)];
  document.getElementById('flag-list').innerHTML = orderedFlags.length
    ? orderedFlags.slice(0,12).map(e=>{
        const d = new Date(e.ts);
        const time = d.toLocaleString('vi-VN', {hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'});
        const lowTp = TOUCHPOINTS.filter(tp=>e.scores && e.scores[tp.id]<=2).map(tp=>tp.label);
        const entryPointLabel = e.entryPoint ? ` · quét QR: ${e.entryPoint}` : '';
        return `
          <div class="flag-item ${e.resolved?'resolved':''}">
            <div class="flag-top"><span>${e.dept||'Không rõ khoa'} · ${time}${entryPointLabel}</span><span>NPS ${e.nps!==null&&e.nps!==undefined?e.nps:'–'}</span></div>
            <div class="flag-text">
              ${lowTp.length? `Điểm thấp: ${lowTp.join(', ')}. `:''}
              ${e.comment ? `"${escapeHtml(e.comment)}"` : '(không có góp ý bằng chữ)'}
            </div>
            <div class="flag-actions">
              <button class="btn-resolve ${e.resolved?'done':''}" data-id="${e.id}">${e.resolved ? `✓ Đã xử lý (${e.resolvedBy||''})` : 'Đánh dấu đã xử lý'}</button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="empty-state">Chưa có phản hồi nào cần chú ý 🎉</div>';
  document.querySelectorAll('.btn-resolve').forEach(btn=>{
    btn.onclick = ()=> toggleResolved(btn.dataset.id);
  });

  document.getElementById('referral-list').innerHTML = referrals.length
    ? `<table class="dept"><thead><tr><th>Tên người được giới thiệu</th><th>Số điện thoại</th><th style="text-align:right;">Khách giới thiệu (khoa)</th></tr></thead><tbody>
        ${referrals.map(r=>`<tr><td>${escapeHtml(r.name||'–')}</td><td>${escapeHtml(r.phone||'–')}</td><td class="num">${r.dept||'–'}</td></tr>`).join('')}
      </tbody></table>`
    : '<div class="empty-state">Chưa có lượt giới thiệu nào trong khoảng thời gian đã chọn</div>';
}

function escapeHtml(s){
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/* ---------------- Init ---------------- */
renderPatient();

supabaseClient.auth.onAuthStateChange((event)=>{
  if(event === 'SIGNED_OUT'){
    staffSession = null;
  }
});

(async function initSession(){
  const { data } = await supabaseClient.auth.getSession();
  if(data && data.session){
    const ok = await refreshDashboard();
    if(ok && viewDash.classList.contains('active')){
      enterDashboard();
    } else if(!ok){
      staffSession = null;
    }
  }
})();
