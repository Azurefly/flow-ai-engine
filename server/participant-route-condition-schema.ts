import { z } from "zod";
import type { ParticipantRouteCondition } from "../shared/participant-route-condition";

const negate = { negate: z.boolean().optional() };
const strings = z.array(z.string().trim().min(1)).min(1);
export const participantRouteConditionSchema: z.ZodType<ParticipantRouteCondition> =
  z.lazy(() =>
    z.discriminatedUnion("kind", [
      z.object({
        ...negate,
        kind: z.literal("group"),
        match: z.enum(["all", "any"]),
        conditions: z.array(participantRouteConditionSchema).min(1),
      }),
      z.object({
        ...negate,
        kind: z.literal("identity"),
        identity: z.enum([
          "isParticipant",
          "isInitiator",
          "isActor",
          "isReceiver",
          "isRelationSender",
          "isRelationReceiver",
        ]),
      }),
      z.object({
        ...negate,
        kind: z.literal("role"),
        roleKeys: strings,
        match: z.enum(["all", "any"]),
      }),
      z.object({
        ...negate,
        kind: z.literal("user"),
        userIds: z.array(z.number().int().positive()).min(1),
      }),
      z
        .object({
          ...negate,
          kind: z.literal("department"),
          unitIds: strings,
          minDepth: z.number().int().nonnegative(),
          maxDepth: z.number().int().nonnegative().nullable(),
          membership: z.enum(["any", "primary"]),
        })
        .refine(
          value => value.maxDepth === null || value.maxDepth >= value.minDepth,
          "最深层级应大于或等于起始层级"
        ),
      z.object({ ...negate, kind: z.literal("state"), stateCodes: strings }),
      z
        .object({
          ...negate,
          kind: z.literal("data"),
          left: z.unknown(),
          operator: z.enum([
            "equals",
            "notEquals",
            "contains",
            "exists",
            "greaterThan",
            "lessThan",
          ]),
          right: z.unknown().optional(),
        })
        .refine(
          value =>
            value.left !== undefined &&
            (value.operator === "exists" || value.right !== undefined),
          "请填写数据条件的比较值"
        ),
    ])
  );
