import assert from "node:assert/strict";
import test from "node:test";
import bcrypt from "bcryptjs";
import { moduleLoader } from "./helpers/load-module";

function loadActions(options: { userId?: string | null; failAt?: string } = {}) {
  const steps: { step: string; args?: any }[] = [];
  const record = (step: string, result: unknown = { count: 0 }) => async (args?: any) => {
    if (options.failAt === step) throw new Error(`boom at ${step}`);
    steps.push({ step, args });
    return result;
  };
  const tx = {
    user: {
      findUnique: record("user.findUnique", { id: "u1", email: "buyer@example.com" }),
      delete: record("user.delete", {}),
    },
    order: { updateMany: record("order.updateMany") },
    address: { updateMany: record("address.updateMany"), deleteMany: record("address.deleteMany") },
    cart: { deleteMany: record("cart.deleteMany") },
    review: {
      findMany: record("review.findMany", [{ productId: "p1" }, { productId: "p2" }, { productId: "p1" }]),
      aggregate: async (args: any) => (steps.push({ step: "review.aggregate", args }), { _avg: { rating: 4 } }),
    },
    product: { updateMany: async (args: any) => (steps.push({ step: "product.updateMany", args }), { count: 1 }) },
  };
  let transactions = 0;
  const signOutCalls: unknown[] = [];
  const load = moduleLoader({
    "@/lib/auth": {
      auth: async () => (options.userId === null ? null : { user: { id: options.userId ?? "u1" } }),
      signOut: async (args: unknown) => void signOutCalls.push(args),
    },
    "@/lib/db": {
      db: {
        $transaction: async (callback: (client: typeof tx) => Promise<void>) => {
          transactions++;
          return callback(tx);
        },
        user: {
          findUnique: async () => ({ id: "u1", password: bcrypt.hashSync("password123", 4) }),
          update: async (args: any) => (steps.push({ step: "db.user.update", args }), {}),
        },
      },
    },
    "next/cache": { revalidatePath: () => undefined },
  });
  return { actions: load("app/profile/actions.ts"), steps, transactions: () => transactions, signOutCalls };
}

test("deleteAccount detaches orders and addresses, clears the cart and recalculates ratings in one transaction", async () => {
  const { actions, steps, transactions, signOutCalls } = loadActions();
  await actions.deleteAccount();

  assert.equal(transactions(), 1);
  const names = steps.map((entry) => entry.step);
  assert.deepEqual(names, [
    "user.findUnique",
    "order.updateMany",
    "order.updateMany",
    "address.updateMany",
    "address.deleteMany",
    "cart.deleteMany",
    "review.findMany",
    "user.delete",
    "review.aggregate",
    "product.updateMany",
    "review.aggregate",
    "product.updateMany",
  ]);

  const [withoutEmail, rest] = steps.filter((entry) => entry.step === "order.updateMany");
  assert.deepEqual(withoutEmail.args, { where: { userId: "u1", guestEmail: null }, data: { guestEmail: "buyer@example.com", userId: null } });
  assert.deepEqual(rest.args, { where: { userId: "u1" }, data: { userId: null } });

  const detach = steps.find((entry) => entry.step === "address.updateMany")!;
  assert.deepEqual(detach.args.where.OR, [{ shippingOrders: { some: {} } }, { billingOrders: { some: {} } }]);
  assert.deepEqual(detach.args.data, { userId: null });
  assert.deepEqual(steps.find((entry) => entry.step === "address.deleteMany")!.args, { where: { userId: "u1" } });
  assert.deepEqual(steps.find((entry) => entry.step === "cart.deleteMany")!.args, { where: { userId: "u1" } });

  const recalculated = steps.filter((entry) => entry.step === "review.aggregate").map((entry) => entry.args.where.productId);
  assert.deepEqual(recalculated, ["p1", "p2"], "each affected product is recalculated once, after the user is deleted");
  assert.deepEqual(signOutCalls, [{ redirectTo: "/" }]);
});

test("deleteAccount reports failure and does not sign out when the transaction fails", async () => {
  const { actions, signOutCalls } = loadActions({ failAt: "cart.deleteMany" });
  const original = console.error;
  console.error = () => undefined;
  try {
    await assert.rejects(() => actions.deleteAccount(), /Failed to delete account/);
  } finally {
    console.error = original;
  }
  assert.equal(signOutCalls.length, 0);
});

test("deleteAccount requires a session", async () => {
  const { actions, transactions } = loadActions({ userId: null });
  await assert.rejects(() => actions.deleteAccount(), /Unauthorized/);
  assert.equal(transactions(), 0);
});

test("updateProfile validates the name and the new password", async () => {
  const { actions, steps } = loadActions();
  await assert.rejects(() => actions.updateProfile({ name: "   " }), /Name must be between 1 and 50/);
  await assert.rejects(() => actions.updateProfile({ name: "x".repeat(51) }), /Name must be between 1 and 50/);
  await assert.rejects(() => actions.updateProfile({ currentPassword: "password123", newPassword: "short" }), /between 8 and 100/);
  await assert.rejects(() => actions.updateProfile({ currentPassword: "password123", newPassword: "x".repeat(101) }), /between 8 and 100/);
  assert.equal(steps.length, 0, "nothing is written for invalid input");
});

test("updateProfile trims the name and still accepts a password-only change from the form", async () => {
  const { actions, steps } = loadActions();
  await actions.updateProfile({ name: "  Jane  " });
  await actions.updateProfile({ name: "", currentPassword: "password123", newPassword: "new-password-1" });
  const updates = steps.filter((entry) => entry.step === "db.user.update");
  assert.equal(updates[0].args.data.name, "Jane");
  assert.equal(updates[1].args.data.name, undefined);
  assert.ok(await bcrypt.compare("new-password-1", updates[1].args.data.password));
});
