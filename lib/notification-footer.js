'use strict';

const { buildUnsubscribeUrl, buildManagePrefsUrl, typeLabel } = require('./unsubscribe-token');
const { EMAIL_TYPES, isRequiredEmailType } = require('./email-types');

function appendUnsubscribeFooter(html, text, userId, emailType) {
  if (!userId || !emailType || !EMAIL_TYPES[emailType]) return { html, text };
  if (isRequiredEmailType(emailType)) return { html, text };
  const unsubTypeUrl = buildUnsubscribeUrl(userId, emailType);
  const unsubAllUrl = buildUnsubscribeUrl(userId, 'all');
  const manageUrl = buildManagePrefsUrl();
  const label = typeLabel(emailType);

  const footerHtml = `
              <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center;">
                <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;line-height:1.6;">
                  You're receiving this because you have ${label} enabled.
                </p>
                <p style="margin:0;font-size:12px;color:#64748b;line-height:1.6;">
                  <a href="${unsubTypeUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe from this type</a>
                  &nbsp;·&nbsp;
                  <a href="${unsubAllUrl}" style="color:#64748b;text-decoration:underline;">Unsubscribe from all</a>
                  &nbsp;·&nbsp;
                  <a href="${manageUrl}" style="color:#0EA5E9;text-decoration:none;">Manage preferences</a>
                </p>
              </div>`;

  let newHtml = html;
  if (typeof html === 'string' && html.length > 0) {
    if (html.includes('<!-- Footer -->')) {
      newHtml = html.replace('          <!-- Footer -->', `${footerHtml}\n          <!-- Footer -->`);
    } else if (html.includes('</body>')) {
      newHtml = html.replace('</body>', `${footerHtml}</body>`);
    } else {
      newHtml = html + footerHtml;
    }
  }

  const footerText = `\n\n---\nUnsubscribe from ${label}: ${unsubTypeUrl}\nUnsubscribe from optional emails: ${unsubAllUrl}\nManage preferences: ${manageUrl}`;
  const newText = text ? text + footerText : footerText.trim();

  return { html: newHtml, text: newText };
}

module.exports = { appendUnsubscribeFooter };
