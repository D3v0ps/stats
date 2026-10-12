import type { StepOp } from "@/lib/contracts";
import type { StepFn } from "../types";
import { clean } from "./clean";
import { constant } from "./constant";
import { drop } from "./drop";
import { fillDown } from "./fill-down";
import { filter } from "./filter";
import { lookup } from "./lookup";
import { merge } from "./merge";
import { negate } from "./negate";
import { rename } from "./rename";
import { reorder } from "./reorder";
import { replace } from "./replace";
import { split } from "./split";
import { unpivot } from "./unpivot";

export const STEP_IMPLEMENTATIONS: { [O in StepOp]: StepFn<O> } = {
  rename,
  drop,
  merge,
  split,
  replace,
  clean,
  lookup,
  filter,
  reorder,
  unpivot,
  fill_down: fillDown,
  negate,
  constant,
};
