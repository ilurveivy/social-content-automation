(function () {
'use strict';
/* ==================== Planning（日历视图） ==================== */
function renderPlanning() {
  const { S, $, esc } = window.SCA;
  const sel = $('planCampaign');
  const sig = S.campaigns.map((c) => c.id + ':' + c.name).join('|');
  if (sel.dataset.sig !== sig) {
    sel.dataset.sig = sig;
    sel.innerHTML = S.campaigns.length
      ? S.campaigns.map((c) => `<option value="${c.id}">${esc(c.name || '(未命名)')}</option>`).join('')
      : '<option value="">（还没有 campaign）</option>';
  }
  sel.value = S.campaignId || '';

  // 进入 Planning 时跟着当前选中资产的排期走（否则"刚排到下月，切过来却看不到"）
  const a = window.SCA.asset();
  if (a && a.scheduledAt) {
    S.calMonth = a.scheduledAt.slice(0, 7);
    S.calManual = true;
  }
  window.SCA.renderCalendar();
}

window.SCA.$('planCampaign').onchange = (e) => {
  const { S } = window.SCA;
  S.campaignId = e.target.value || null;
  S.assetId = null;
  S.calManual = false;
  renderPlanning();
};

window.renderPlanning = renderPlanning;
})();
