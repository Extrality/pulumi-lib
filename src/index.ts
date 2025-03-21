import type * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { deepmerge } from "deepmerge-ts";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import assert from "node:assert";

export * as helm from "./helm.js";
export * as githubFiles from "./github_files.js";

export function notNull<T>(obj: T): NonNullable<T> {
  if (obj === undefined || obj === null) {
    throw new Error("Object is not allowed to be null or undefined.");
  }
  return obj;
}

export function notFalsy<T>(
  obj: T,
): T extends false | 0 | "" | null | undefined ? never : NonNullable<T> {
  if (!obj) {
    throw new Error("Object is not allowed to be falsy");
  }
  return obj as any;
}

/**
 * Allows to use pulumi's input types without the hassle of Input<T>
 *
 * This allows eg: a helm chart transform to use the type k8s.types.input.core.v1.Container
 * */
export type UnwrapedInput<T> = T extends pulumi.Input<infer U>
  ? U extends object
    ? UnwrapInputObject<U>
    : U
  : T extends object
    ? UnwrapInputObject<T>
    : T;
type UnwrapInputObject<T> = {
  [P in keyof T]: UnwrapedInput<T[P]>;
};

export function basicCreateNamespace(
  name: string,
  provider: k8s.Provider,
  platform: string,
  params?: k8s.core.v1.NamespaceArgs,
  opts?: pulumi.CustomResourceOptions,
) {
  params = deepmerge(
    { metadata: { name, labels: { "app.kubernetes.io/part-of": "simai" } } },
    params ?? {},
  );
  opts = deepmerge({ provider }, opts ?? {});
  const namespace = new k8s.core.v1.Namespace(name, params, opts);
  const namespaceName = namespace.metadata.apply((m) => m.name);

  return namespaceName;
}

export async function getCacheDir(): Promise<string> {
  const currentPath = process.cwd().split("/");
  assert.equal(currentPath.slice(-3, -1).join("/"), "<path to your folders to check the code is not placing cache at a wrong location>");
  const gitRepo = currentPath.slice(0, -3).join("/");
  const cacheDir = `${gitRepo}/.cache`;
  await fs.mkdir(cacheDir).catch((err) => {
    if (err.code !== "EEXIST") {
      throw err;
    }
  });
  return cacheDir;
}
