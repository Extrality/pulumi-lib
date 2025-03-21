import * as pulumi from "@pulumi/pulumi";
import type { CheckFailure } from "@pulumi/pulumi/dynamic/index.js";

interface MultirotateInputs {
  /** default: `60` */
  rotationPeriodDays?: number;
  /** default: `1` */
  count?: number;
}

interface MultirotateOutputs {
  /** index of last rotated timetamp */
  index: number;
  rotationPeriodDays: number;
  timestamps: string[];
  /** `timestamps[index]` */
  currentTimestamp: string;
}

class MultiRotateProvider
  implements
    pulumi.dynamic.ResourceProvider<MultirotateInputs, MultirotateOutputs>
{
  async check(olds: MultirotateInputs, news: MultirotateInputs) {
    const result = {
      failures: <CheckFailure[]>[],
      inputs: news,
    };
    if (news.count === undefined) {
      news.count = 1;
    } else if (news.count < 1 || !Number.isInteger(news.count)) {
      result.failures.push({
        property: "count",
        reason: "Must be a positive integer",
      });
    }
    if (news.rotationPeriodDays === undefined) {
      news.rotationPeriodDays = 60;
    } else if (
      news.rotationPeriodDays < 1 ||
      !Number.isInteger(news.rotationPeriodDays)
    ) {
      result.failures.push({
        property: "rotationPeriodDays",
        reason: "Must be a positive integer",
      });
    }
    return result;
  }

  async create(
    inputs: MultirotateInputs,
  ): Promise<pulumi.dynamic.CreateResult<MultirotateOutputs>> {
    const curDate = new Date();
    const curTs = curDate.toISOString();
    const rotationItems = [];
    for (let i = 0; i < inputs.count!; i += 1) {
      rotationItems.push(curTs);
    }
    const exp = new Date();
    exp.setDate(exp.getDay() + inputs.rotationPeriodDays!);

    return {
      id: curTs,
      outs: {
        rotationPeriodDays: inputs.rotationPeriodDays!,
        index: 0,
        timestamps: rotationItems,
        currentTimestamp: rotationItems[0],
      },
    };
  }

  async diff(id: string, olds: MultirotateOutputs, news: MultirotateInputs) {
    if (
      olds.index === undefined ||
      olds.timestamps === undefined ||
      olds.currentTimestamp === undefined ||
      olds.rotationPeriodDays === undefined
    ) {
      return { changes: true };
    }
    if (olds.timestamps.length !== news.count) {
      console.log("FUCK B");
      return { changes: true };
    }
    const exp = new Date(Date.parse(olds.timestamps[olds.index]));
    exp.setDate(exp.getDate() + news.rotationPeriodDays!);
    if (Date.now() > exp.valueOf()) {
      console.log("FUCK C");
      return { changes: true };
    }
    return { changes: false };
  }

  async update(id: string, olds: MultirotateOutputs, news: MultirotateInputs) {
    olds.rotationPeriodDays = news.rotationPeriodDays!;
    olds.timestamps ??= [];
    olds.index ??= 0;

    while (olds.timestamps.length < news.count!) {
      olds.timestamps.push(new Date().toISOString());
    }
    if (olds.timestamps.length > news.count!) {
      olds.timestamps = olds.timestamps.slice(0, news.count!);
      olds.index %= news.count!;
    }
    const exp = new Date(Date.parse(olds.timestamps[olds.index]));
    exp.setDate(exp.getDate() + news.rotationPeriodDays!);

    if (Date.now() > exp.valueOf()) {
      const ts = new Date(Date.now()).toISOString();
      olds.index = (olds.index + 1) % olds.timestamps.length;
      olds.timestamps[olds.index] = ts;
    }
    olds.currentTimestamp = olds.timestamps[olds.index];

    return { outs: olds };
  }
}

export type MultirotateRessourceInputs = {
  [K in keyof MultirotateInputs]: pulumi.Input<MultirotateInputs[K]>;
};

/**
 * Pulumi ressource to rotate creadentials.
 *
 * It returns `timestamps` and `index`:
 *
 * ```
 * ["2023-02-21T11:08:46Z", "2024-02-21T11:08:46Z"]
 *                                ^ index
 * ```
 *
 * When the ts pointed at by `index` is older than `expirationDays`,
 * the cursor moves to the next timestamps, which gets updated.
 */
export class MultiRotateResource extends pulumi.dynamic.Resource {
  declare readonly timestamps: pulumi.Output<string[]>;
  declare readonly currentTimestamp: pulumi.Output<string>;
  declare readonly index: pulumi.Output<number>;

  constructor(
    name: string,
    props: MultirotateRessourceInputs,
    opts?: pulumi.CustomResourceOptions,
  ) {
    super(
      new MultiRotateProvider(),
      name,
      {
        timestamps: undefined,
        currentTimestamp: undefined,
        index: undefined,
        ...props,
      },
      opts,
    );
  }
}
