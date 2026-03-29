import type { QueryOptions, WhereCondition } from "../workflow-sdk.js";

interface ResourceConfig {
  table: string;
  /** Maps camelCase SDK field names to snake_case DB column names. */
  fields: Record<string, string>;
}

const RESOURCES: Record<string, ResourceConfig> = {
  sessions: {
    table: "sessions",
    fields: {
      id: "id",
      customerName: "customer_name",
      status: "status",
      sentiment: "sentiment",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },
  session_messages: {
    table: "session_messages",
    fields: {
      id: "id",
      sessionId: "session_id",
      authorRole: "author_role",
      body: "body",
      createdAt: "created_at",
    },
  },
};

const OP_MAP: Record<WhereCondition["op"], string> = {
  eq: "=",
  neq: "!=",
  in: "= ANY",
  gt: ">",
  lt: "<",
  gte: ">=",
  lte: "<=",
  like: "LIKE",
};

export interface BuiltQuery {
  text: string;
  values: unknown[];
}

export function buildQuery(
  resourceName: string,
  options?: QueryOptions,
): BuiltQuery {
  const resource = RESOURCES[resourceName];
  if (!resource) {
    throw new Error(`Unknown resource: ${resourceName}`);
  }

  const columns = Object.values(resource.fields).join(", ");
  let text = `SELECT ${columns} FROM ${resource.table}`;
  const values: unknown[] = [];
  let paramIdx = 1;

  if (options?.where && options.where.length > 0) {
    const clauses: string[] = [];

    for (const condition of options.where) {
      const column = resource.fields[condition.field];
      if (!column) {
        const allowed = Object.keys(resource.fields).join(", ");
        throw new Error(
          `Unknown field "${condition.field}" for resource "${resourceName}". Allowed: ${allowed}`,
        );
      }

      const sqlOp = OP_MAP[condition.op];
      if (!sqlOp) {
        throw new Error(`Unknown operator: ${condition.op}`);
      }

      if (condition.op === "in") {
        clauses.push(`${column} = ANY($${paramIdx})`);
        values.push(
          Array.isArray(condition.value) ? condition.value : [condition.value],
        );
      } else {
        clauses.push(`${column} ${sqlOp} $${paramIdx}`);
        values.push(condition.value);
      }
      paramIdx++;
    }

    text += ` WHERE ${clauses.join(" AND ")}`;
  }

  if (options?.orderBy) {
    const orderColumn = resource.fields[options.orderBy.field];
    if (!orderColumn) {
      throw new Error(
        `Unknown orderBy field "${options.orderBy.field}" for resource "${resourceName}"`,
      );
    }
    const dir = options.orderBy.direction === "desc" ? "DESC" : "ASC";
    text += ` ORDER BY ${orderColumn} ${dir}`;
  }

  if (options?.limit != null && options.limit > 0) {
    text += ` LIMIT $${paramIdx}`;
    values.push(options.limit);
  }

  return { text, values };
}
