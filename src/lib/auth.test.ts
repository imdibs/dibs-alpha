import { beforeAll,describe,expect,it } from "vitest";
beforeAll(()=>{process.env.SESSION_SECRET="a-secure-test-secret-that-is-over-32-characters"});
describe("signed Alpha sessions",()=>{
  it("accepts an untampered session",async()=>{const {makeSession,verifySession}=await import("./auth");expect(verifySession(makeSession("user-123"))).toBe("user-123")});
  it("rejects a changed user id",async()=>{const {makeSession,verifySession}=await import("./auth");const token=makeSession("user-123");expect(verifySession(token.replace("user-123","user-456"))).toBeNull()});
  it("hashes and verifies passwords",async()=>{const {hashPassword,verifyPassword}=await import("./auth");const hash=await hashPassword("correct horse");expect(hash).not.toContain("correct horse");expect(await verifyPassword("correct horse",hash)).toBe(true);expect(await verifyPassword("wrong horse",hash)).toBe(false)});
});