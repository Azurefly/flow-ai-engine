import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import superjson from "superjson";
const base = "http://124.223.198.84:1180";
class Session {
  cookie = "";
  async request(path, input, mutation = false) {
    const body = JSON.stringify(superjson.serialize(input ?? null));
    const response = await fetch(
      `${base}/api/trpc/${path}${mutation ? "" : `?input=${encodeURIComponent(body)}`}`,
      {
        method: mutation ? "POST" : "GET",
        headers: { "content-type": "application/json", cookie: this.cookie },
        ...(mutation ? { body } : {}),
        signal: AbortSignal.timeout(30000),
      }
    );
    const nextCookie = response.headers.getSetCookie()[0];
    if (nextCookie) this.cookie = nextCookie.split(";", 1)[0];
    const payload = await response.json();
    if (!response.ok || payload.error)
      throw new Error(
        payload.error?.json?.message ?? `HTTP ${response.status}`
      );
    return superjson.deserialize(payload.result.data);
  }
}
const admin = new Session(),
  actor = new Session(),
  member = new Session();
const people = [],
  tag = randomBytes(6).toString("hex");
const legacy = process.env.FLOW_EXPECT_LEGACY_STATUS === "1";
await admin.request(
  "auth.login",
  {
    username: process.env.FLOW_BOOTSTRAP_ADMIN_USERNAME,
    password: process.env.FLOW_BOOTSTRAP_ADMIN_PASSWORD,
  },
  true
);
async function account(person) {
  const directory = await admin.request("iam.userDirectory", {
    search: person.login.username,
    offset: 0,
    limit: 20,
  });
  const value = directory.items.find(
    item => item.username === person.login.username
  );
  assert.equal(value.id, person.id);
  return value;
}
async function change(person, status, expected = undefined) {
  return admin.request(
    "iam.updateUserStatus",
    {
      userId: person.id,
      status,
      ...(expected
        ? {
            expectedStatus: expected.status,
            expectedVersion: expected.statusVersion,
          }
        : {}),
    },
    true
  );
}
try {
  for (const role of ["user", "admin"]) {
    const login = {
      username: `status_${tag}_${role}`,
      password: "Test9_" + randomBytes(24).toString("base64url"),
    };
    const { userId } = await admin.request(
      "iam.createUser",
      { ...login, name: `启停隔离_${tag}_${role}`, role },
      true
    );
    people.push({ id: userId, login });
  }
  const [person, administrator] = people;
  await actor.request("auth.login", administrator.login, true);
  const selfAction = () =>
    actor.request(
      "iam.updateUserStatus",
      { userId: administrator.id, status: "disabled" },
      true
    );
  if (legacy) {
    await selfAction();
    assert.equal(await actor.request("auth.me", null), null);
    await change(administrator, "active");
  } else {
    await assert.rejects(selfAction, /当前登录账号/);
    assert.equal((await account(administrator)).status, "active");
  }
  console.log(JSON.stringify({ scenario: "self_disable", denied: !legacy }));
  await member.request("auth.login", person.login, true);
  const before = await account(person);
  if (!legacy) assert(Number.isInteger(before.statusVersion));
  const choices = await Promise.allSettled([
    change(person, "disabled", before),
    change(person, "disabled", before),
  ]);
  assert.equal(
    choices.filter(choice => choice.status === "fulfilled").length,
    legacy ? 2 : 1
  );
  if (!legacy)
    assert(
      choices
        .find(choice => choice.status === "rejected")
        .reason.message.includes("状态已变化")
    );
  const disabled = await account(person);
  assert.equal(disabled.status, "disabled");
  if (!legacy) assert.equal(disabled.statusVersion, before.statusVersion + 1);
  assert.equal(await member.request("auth.me", null), null);
  console.log(
    JSON.stringify({
      scenario: "concurrent_stale_status",
      winners: legacy ? 2 : 1,
      sessionsInvalid: true,
    })
  );
  await change(person, "active", disabled);
  const restored = await account(person);
  if (!legacy) assert.equal(restored.statusVersion, before.statusVersion + 2);
  assert.equal(await member.request("auth.me", null), null);
  console.log(
    JSON.stringify({
      scenario: "reactivation_does_not_restore_old_session",
      verified: true,
    })
  );
  if (legacy) {
    await change(person, "disabled", before);
    await change(person, "active");
  } else
    await assert.rejects(
      () => change(person, "disabled", before),
      /状态已变化/
    );
  assert.equal((await account(person)).status, "active");
  console.log(
    JSON.stringify({
      scenario: "old_revision_after_round_trip",
      denied: !legacy,
    })
  );
  await member.request("auth.login", person.login, true);
  const latest = await account(person);
  const logins = [new Session(), new Session()];
  const concurrent = await Promise.allSettled([
    ...logins.map(session => session.request("auth.login", person.login, true)),
    change(person, "disabled", latest),
  ]);
  assert.equal(concurrent[2].status, "fulfilled");
  assert.equal((await account(person)).status, "disabled");
  for (const session of [member, ...logins])
    assert.equal(await session.request("auth.me", null), null);
  await change(person, "active", await account(person));
  const staleSessions = [];
  for (const session of [member, ...logins])
    staleSessions.push(Boolean(await session.request("auth.me", null)));
  if (!legacy) assert.deepEqual(staleSessions, [false, false, false]);
  console.log(
    JSON.stringify({
      scenario: "login_disable_interleaving",
      successfulLogins: concurrent
        .slice(0, 2)
        .filter(r => r.status === "fulfilled").length,
      oldSessionReactivated: staleSessions.some(Boolean),
    })
  );
  await change(person, "disabled");
  const repeated = await change(person, "disabled");
  if (!legacy) assert.equal(repeated.changed, false);
  console.log(
    JSON.stringify({ scenario: "idempotent_cleanup", verified: true })
  );
  const audit = (
    await admin.request("iam.authorizationAudit", { limit: 200 })
  ).filter(
    row =>
      Number(row.targetUserId) === person.id &&
      ["user_updated", "user_disabled"].includes(row.action)
  );
  assert(audit.length > 0);
  if (!legacy) {
    const read = value =>
      typeof value === "string" ? JSON.parse(value) : value;
    for (const event of audit)
      assert(Number.isInteger(read(event.detailsJson).statusVersion));
  }
  console.log(
    JSON.stringify({
      scenario: "status_audit_revision",
      events: audit.length,
      verified: true,
    })
  );
} finally {
  const errors = [];
  for (const person of people)
    await change(person, "disabled").catch(error => errors.push(error.message));
  assert.deepEqual(errors, [], "启停隔离账号清理失败");
  console.log(JSON.stringify({ ownAccountsDisabled: people.length }));
}
