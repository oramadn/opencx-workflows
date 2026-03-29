import type { Task } from "graphile-worker";

/** Example task; enqueue with `graphile_worker.add_job('hello', json_build_object(...))` or the JS API. */
const hello: Task = async (payload) => {
  console.log("[hello]", payload);
};

export default hello;
