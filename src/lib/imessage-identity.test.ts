import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredUser = { id: string; name: string | null; city: string | null; imessage_address: string };

const state = vi.hoisted(() => ({
  users: [] as StoredUser[],
  nextId: 1,
  loseNextInsertRace: false,
}));

vi.mock("./db", () => ({
  db: () => ({
    from: (table: string) => {
      if (table !== "users") throw new Error(`Unexpected table: ${table}`);
      return {
        select: () => ({
          eq: (_column: string, identity: string) => ({
            maybeSingle: async () => ({ data: state.users.find(user => user.imessage_address === identity) || null, error: null }),
          }),
        }),
        insert: (values: { imessage_address: string }) => ({
          select: () => ({
            single: async () => {
              if (state.loseNextInsertRace) {
                state.loseNextInsertRace = false;
                state.users.push({ id: `user-${state.nextId++}`, name: null, city: null, imessage_address: values.imessage_address });
                return { data: null, error: { code: "23505" } };
              }
              if (state.users.some(user => user.imessage_address === values.imessage_address)) return { data: null, error: { code: "23505" } };
              const user = { id: `user-${state.nextId++}`, name: null, city: null, imessage_address: values.imessage_address };
              state.users.push(user);
              return { data: user, error: null };
            },
          }),
        }),
      };
    },
  }),
}));

import { normalizeIMessageIdentity, recognizeIMessageUser } from "./marketplace";

describe("phone-first iMessage identity", () => {
  beforeEach(() => {
    state.users.length = 0;
    state.nextId = 1;
    state.loseNextInsertRace = false;
  });

  it("creates a minimal user without email and recognizes it thereafter", async () => {
    const first = await recognizeIMessageUser("+1 (628) 264-6604");
    const second = await recognizeIMessageUser("+16282646604");

    expect(first).toEqual({ user: { id: "user-1", name: null, city: null, imessage_address: "+16282646604" }, isNew: true });
    expect(second).toEqual({ user: first?.user, isNew: false });
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).not.toHaveProperty("email");
  });

  it("normalizes equivalent phone forms and rejects unqualified identities", () => {
    expect(normalizeIMessageIdentity(" +1 (628) 264-6604 ")).toBe("+16282646604");
    expect(normalizeIMessageIdentity("+16282646604")).toBe("+16282646604");
    expect(normalizeIMessageIdentity("6282646604")).toBeNull();
  });

  it("returns the unique winner when simultaneous first messages race", async () => {
    state.loseNextInsertRace = true;
    const recognized = await recognizeIMessageUser("+16282646604");

    expect(recognized).toEqual({ user: state.users[0], isNew: false });
    expect(state.users).toHaveLength(1);
  });

  it("preserves an existing Alpha identity mapping", async () => {
    state.users.push({ id: "alpha-user", name: "Alpha", city: "Miami, FL", imessage_address: "+16282646604" });

    expect(await recognizeIMessageUser("+1 (628) 264-6604")).toEqual({ user: state.users[0], isNew: false });
    expect(state.users).toHaveLength(1);
  });
});