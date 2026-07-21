const { getSupabaseAdmin } = require('./_lib/supabaseAdmin');

const DEPARTMENTS = ['Nội', 'QL bệnh Huyết áp - Tiểu đường', 'Y học cổ truyền', 'Sản', 'Nhi', 'Ngoại', 'Cấp cứu'];
const ENTRY_POINTS = ['letan', 'kham', 'canlamsang', 'nhathuoc'];
const MAX_REFERRALS = 2;

function isValidScore(v) {
  return Number.isInteger(v) && v >= 1 && v <= 5;
}
// Cận lâm sàng và Nhà thuốc cho phép "không sử dụng dịch vụ" (null); Lễ tân và Khám bệnh luôn bắt buộc.
function isValidScoreOrNA(v, allowNA) {
  if (allowNA && (v === null || v === undefined)) return true;
  return isValidScore(v);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body || {};
    const { department, entryPoint, scores, nps, comment, referrals } = body;

    if (!DEPARTMENTS.includes(department)) {
      res.status(400).json({ error: 'Khoa không hợp lệ' });
      return;
    }
    if (entryPoint !== null && entryPoint !== undefined && !ENTRY_POINTS.includes(entryPoint)) {
      res.status(400).json({ error: 'entry_point không hợp lệ' });
      return;
    }
    const s = scores || {};
    const scoresValid =
      isValidScore(s.letan) &&
      isValidScore(s.kham) &&
      isValidScoreOrNA(s.canlamsang, true) &&
      isValidScoreOrNA(s.nhathuoc, true);
    if (!scoresValid) {
      res.status(400).json({ error: 'Điểm đánh giá không hợp lệ' });
      return;
    }
    if (!Number.isInteger(nps) || nps < 0 || nps > 10) {
      res.status(400).json({ error: 'Điểm NPS không hợp lệ' });
      return;
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('survey_responses')
      .insert({
        department,
        entry_point: entryPoint || null,
        score_letan: s.letan,
        score_kham: s.kham,
        score_canlamsang: s.canlamsang,
        score_nhathuoc: s.nhathuoc,
        nps,
        comment: (comment || '').slice(0, 2000) || null,
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    const referralRows = (Array.isArray(referrals) ? referrals : [])
      .filter((r) => r && (r.name || r.phone))
      .slice(0, MAX_REFERRALS)
      .map((r) => ({
        survey_response_id: inserted.id,
        name: (r.name || '').slice(0, 200) || null,
        phone: (r.phone || '').slice(0, 50) || null,
      }));

    if (referralRows.length) {
      const { error: refError } = await supabaseAdmin.from('referrals').insert(referralRows);
      if (refError) throw refError;
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('submit-survey error', e);
    res.status(500).json({ error: 'Không gửi được, vui lòng thử lại.' });
  }
};
