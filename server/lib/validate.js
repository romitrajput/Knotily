// Input validation. Every field from the browser is checked here before use.
import { bad } from '../http.js';

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const INDIAN_STATES = ['Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal'];
export const GENDERS = ['female', 'male', 'non-binary', 'prefer-not-to-say'];

export function str(v, { field, min = 0, max = 200, required = false } = {}) {
  const s = typeof v === 'string' ? v.trim() : v === undefined || v === null ? '' : String(v).trim();
  if (required && !s) throw bad('INVALID', `${field} is required.`, { field });
  if (s && s.length < min) throw bad('INVALID', `${field} is too short.`, { field });
  if (s.length > max) throw bad('INVALID', `${field} is too long.`, { field });
  return s;
}

export function email(v) {
  const s = str(v, { field: 'Email', max: 254, required: true }).toLowerCase();
  if (!EMAIL_RE.test(s)) throw bad('INVALID', 'Enter an email like name@example.com.', { field: 'email' });
  return s;
}

// At least 8 characters with a letter and a number; both entries must match.
export function newPassword(password, confirm) {
  if (typeof password !== 'string' || password.length < 8) throw bad('WEAK_PASSWORD', 'Use at least 8 characters.', { field: 'password' });
  if (password.length > 72) throw bad('WEAK_PASSWORD', 'Use 72 characters or fewer.', { field: 'password' });
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) throw bad('WEAK_PASSWORD', 'Use at least one letter and one number.', { field: 'password' });
  if (password !== confirm) throw bad('PASSWORD_MISMATCH', 'The two passwords do not match.', { field: 'confirmPassword' });
  return password;
}

export function uuid(v, field = 'id') {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw bad('INVALID', `Invalid ${field}.`, { field });
  return v;
}

export function int(v, { field, min = 0, max = 1e9 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad('INVALID', `${field} must be a whole number between ${min} and ${max}.`, { field });
  return n;
}

export function shipping(s = {}) {
  const out = {
    fullName: str(s.fullName, { field: 'Full name', min: 2, max: 80, required: true }),
    phone: str(s.phone, { field: 'Mobile number', max: 20, required: true }).replace(/\D/g, '').slice(-10),
    line1: str(s.line1, { field: 'Address', min: 4, max: 160, required: true }),
    line2: str(s.line2, { field: 'Address line 2', max: 160 }),
    landmark: str(s.landmark, { field: 'Landmark', max: 120 }),
    city: str(s.city, { field: 'City', min: 2, max: 80, required: true }),
    state: str(s.state, { field: 'State', required: true }),
    pin: str(s.pin, { field: 'PIN code', required: true }),
  };
  if (!/^[6-9]\d{9}$/.test(out.phone)) throw bad('INVALID', 'Enter a 10-digit mobile number.', { field: 'phone' });
  if (!/^[1-9]\d{5}$/.test(out.pin)) throw bad('INVALID', 'Enter a 6-digit PIN code.', { field: 'pin' });
  if (!INDIAN_STATES.includes(out.state)) throw bad('INVALID', 'Choose your state.', { field: 'state' });
  const age = s.age === undefined || s.age === null || s.age === '' ? null : int(s.age, { field: 'Age', min: 13, max: 100 });
  const gender = s.gender ? str(s.gender, { field: 'Gender', max: 24 }) : null;
  if (gender && !GENDERS.includes(gender)) throw bad('INVALID', 'Choose a gender option or leave it blank.', { field: 'gender' });
  return { ...out, age, gender };
}
