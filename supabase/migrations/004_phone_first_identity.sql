-- Photon authenticates the inbound iMessage identity. Web credentials remain
-- optional attributes and continue to be required by the existing web login.
alter table users
  alter column email drop not null,
  alter column name drop not null,
  alter column city drop not null,
  alter column password_hash drop not null;

alter table users add constraint users_web_credentials_check check (
  (email is null and password_hash is null)
  or (email is not null and password_hash is not null)
);

alter table users add constraint users_imessage_address_normalized_check check (
  imessage_address is null
  or imessage_address ~ '^\+[0-9]{8,15}$'
  or (
    imessage_address = lower(imessage_address)
    and imessage_address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

comment on column users.imessage_address is
  'Canonical Photon-authenticated Dibs identity: normalized E.164 phone number or lowercase iMessage email. Never expose to another user.';
comment on column users.email is
  'Optional legacy web login/recovery address. Not required for iMessage marketplace use.';