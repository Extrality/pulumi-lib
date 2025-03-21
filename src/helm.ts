import assert from "node:assert/strict";
import * as fsSync from "node:fs";
import { promises as fs } from "node:fs";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as yaml from "js-yaml";

import { getCacheDir } from "./index.js";

const exec = promisify(execCallback);

/**
 * `k8s.helm.v3.Chart` with the added features:
 *   * Graceful migration from v3 Chart
 * Useful for cases where resources with helm hooks should be deployed (as v4 ignores them).
 */
export class ChartV3 extends k8s.helm.v3.Chart {
  constructor(
    secretCode: string,
    releaseName: string,
    config: k8s.helm.v3.ChartOpts | k8s.helm.v3.LocalChartOpts,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    assert.equal(secretCode, "waptadi");
    super(releaseName, config, opts);
  }

  static async new(
    releaseName: string,
    config: k8s.helm.v3.ChartOpts | k8s.helm.v3.LocalChartOpts,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    // cache the chart files
    if ("chart" in config) {
      const anyConfig = config as any;
      const localPath = await chartFromCache(
        anyConfig.chart as string,
        anyConfig.version,
        anyConfig.fetchOpts?.repo,
      );
      anyConfig.chart = undefined;
      anyConfig.fetchOpts = undefined;
      anyConfig.path = localPath;
    }

    // gracefully migrate from v4
    const project = pulumi.getProject();
    const stack = pulumi.getStack();
    config.transformations ??= [];
    config.transformations.push(
      (o: any, opts: pulumi.CustomResourceOptions) => {
        const namespace = o.metadata?.namespace
          ? `${o.metadata.namespace}/`
          : "";
        const apiVersion = o.apiVersion === "v1" ? "core/v1" : o.apiVersion;
        const helmV4Urn = `urn:pulumi:${stack}::${project}::kubernetes:helm.sh/v4:Chart$kubernetes:${apiVersion}:${o.kind}::${releaseName}:${namespace}${o.metadata?.name}`;
        opts.aliases ??= [];
        opts.aliases.push(helmV4Urn);
      },
    );
    return new ChartV3("waptadi", releaseName, config, opts);
  }
}

/**
 * `k8s.helm.v4.Chart` with the added features:
 *   * Graceful migration from v3 Chart
 */
export class ChartV4 extends k8s.helm.v4.Chart {
  constructor(
    secretCode: string,
    releaseName: string,
    config: k8s.helm.v4.ChartArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    assert.equal(secretCode, "Fume cette cigarette");
    super(releaseName, config, opts);
  }

  static async new(
    releaseName: string,
    config: k8s.helm.v4.ChartArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    // cache the chart files
    const anyConfig = config as any;
    const localPath = chartFromCache(
      anyConfig.chart,
      anyConfig.version,
      anyConfig.repositoryOpts?.repo,
    );
    config.chart = localPath;

    // gracefully migrate from v3
    const project = pulumi.getProject();
    const stack = pulumi.getStack();
    opts ??= {};
    opts.transforms ??= [];
    opts.transforms.push(({ props, opts: rOpts }) => {
      if (!props.apiVersion) {
        // ignore the chart resource itself
        return;
      }
      const namespace = props.metadata?.namespace
        ? `${props.metadata.namespace}/`
        : "";
      const apiVersion =
        props.apiVersion === "v1" ? "core/v1" : props.apiVersion;
      const helmV3Urn = `urn:pulumi:${stack}::${project}::kubernetes:helm.sh/v3:Chart$kubernetes:${apiVersion}:${props.kind}::${namespace}${props.metadata?.name}`;
      if (releaseName === "trow") {
        console.log(helmV3Urn);
      }
      return {
        props,
        opts: pulumi.mergeOptions(rOpts, {
          aliases: [helmV3Urn],
          provider: opts.provider,
        }),
      };
    });
    return new ChartV4("Fume cette cigarette", releaseName, config, opts);
  }
}

async function chartFromCache(
  chart: string,
  version: string,
  repo: string | undefined,
) {
  const hasher = createHash("sha256");
  hasher.update(repo || chart);
  const repoHash = hasher.digest("base64").substring(0, 4);
  // remove oci://...
  const shortChartName = chart.split("/").slice(-1)[0];

  const cacheDir = await getCacheDir();
  const localName = `${shortChartName}-${repoHash}`.replace(
    /[^a-zA-Z0-9-]/g,
    "-",
  );
  const localPath = `${cacheDir}/helm-charts/${localName}/${version}`;
  const chartArg = repo ? `${chart} --repo ${repo}` : chart;

  if (!fsSync.existsSync(localPath)) {
    await exec(
      `helm pull ${chartArg} --version '${version}' -d ${localPath} --untar`,
    );
  }

  // https://github.com/helm/helm/issues/10459
  return `${localPath}/${shortChartName}`;
}

/**
 * Remake of ChartV3.getResource() for Chart v4.
 *
 * `match` is of the form `"{apiVersion}:{kind}:{namespace}:{name}"`
 */
export function getResource<T extends pulumi.Resource = pulumi.Resource>(
  chart: k8s.helm.v4.Chart,
  match: pulumi.Input<string>,
): pulumi.Output<T> {
  const resources = chart.resources.apply((resources) =>
    pulumi.all(
      resources.map((r) => {
        const namespace = pulumi
          .output(r.metadata?.namespace)
          .apply((n) => n || "");
        return pulumi.all([
          r as pulumi.Resource,
          pulumi.interpolate`${r.apiVersion}:${r.kind}:${namespace}:${r.metadata?.name}`,
        ]);
      }),
    ),
  );
  return pulumi.all([resources, match]).apply(([resources, match]) => {
    const matchingResources = resources.filter(([_, name]) => name === match);
    const matchingResourceNames = matchingResources.map(([_, n]) => n);
    const resourceNames = resources.map(([_, name]) => name);

    assert.equal(
      matchingResources.length,
      1,
      `Exactly 1 resource should match '${match}'\nMatched: '${matchingResourceNames}'\nOut of: ${resourceNames}`,
    );
    return matchingResources[0][0] as T;
  });
}

export const ignoreResourcesHelmTransformation = (...resources: string[]) => {
  const stack = pulumi.getStack();
  const project = pulumi.getProject();
  return (o: any, opts: pulumi.CustomResourceOptions) => {
    const resourceName = `${o.apiVersion}:${o.kind}:${o.metadata?.namespace || ""}:${o.metadata?.name || ""}`;
    if (resources.includes(resourceName)) {
      console.log(`Skip: ${resourceName}`);
      const dir = `../../../resources/deployed-outside-pulumi-${stack}`;
      if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir);
      }
      fsSync.writeFileSync(
        `${dir}/${project}-${resourceName.replaceAll("/", "-")}.yaml`,
        yaml.dump(o),
      );
      for (const key of Object.keys(o)) {
        delete o[key];
      }
      o.apiVersion = "v1";
      o.kind = "List";
      o.items = [];
    }
  };
};
