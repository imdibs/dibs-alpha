alter table alpha_onboardings
  drop constraint alpha_onboardings_phone_e164_check,
  add constraint alpha_onboardings_phone_e164_check
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$');

comment on column alpha_onboardings.phone_e164 is
  'Canonical E.164 identity used for Alpha onboarding and Photon iMessage delivery.';