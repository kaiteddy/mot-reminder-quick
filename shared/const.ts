export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/** ELI's own phone numbers. A customer record should never carry one of these: they get typed onto
 *  job sheets by mistake, and the merge dialog was ready to adopt one as a customer's mobile
 *  (07843275372 sits on twelve of one trade account's invoices — it is Adam's). Compared on digits
 *  only, so 0208…, +44208… and "0208 203 6449" all match. */
export const OUR_PHONE_NUMBERS = [
  "02082036449",   // workshop landline
  "07950250970",   // workshop mobile
  "07843275372",   // Adam
];
export const isOurNumber = (v: string | null | undefined) => {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^44/, "0");
  if (d.length < 7) return false;
  return OUR_PHONE_NUMBERS.some((n) => {
    const m = n.replace(/\D/g, "").replace(/^44/, "0");
    return m === d || m.slice(-9) === d.slice(-9);
  });
};
