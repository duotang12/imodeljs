/*---------------------------------------------------------------------------------------------
* Copyright (c) 2019 Bentley Systems, Incorporated. All rights reserved.
* Licensed under the MIT License. See LICENSE.md in the project root for license terms.
*--------------------------------------------------------------------------------------------*/

import { Capabilities } from "./System";
import { GLTimerResult, GLTimerResultCallback } from "./../System";
import { BentleyStatus } from "@bentley/bentleyjs-core";
import { IModelError } from "@bentley/imodeljs-common";

class DisjointTimerExtension {
  private _e: any; // EXT_disjoint_timer_query, not available in lib.dom.d.ts

  public constructor(capabilities: Capabilities) {
    this._e = capabilities.queryExtensionObject<any>("EXT_disjoint_timer_query");
  }

  public get isSupported(): boolean { return this._e !== undefined; }

  public createQuery() { return this._e.createQueryEXT() as WebGLObject; }
  public deleteQuery(q: WebGLObject) { this._e.deleteQueryEXT(q); }

  public beginQuery(q: WebGLObject) { this._e.beginQueryEXT(this._e.TIME_ELAPSED_EXT, q); }
  public endQuery() { this._e.endQueryEXT(this._e.TIME_ELAPSED_EXT); }

  public isResultAvailable(q: WebGLObject): boolean {
    return this._e.getQueryObjectEXT(q, this._e.QUERY_RESULT_AVAILABLE_EXT);
  }
  public getResult(q: WebGLObject): number {
    return this._e.getQueryObjectEXT(q, this._e.QUERY_RESULT_EXT);
  }
}

interface QueryEntry {
  label: string;
  query: WebGLObject;
  children?: QueryEntry[];
}

/** Record GPU hardware queries to profile independent of CPU.
 *
 * This is a wrapper around EXT_disjoint_timer_query. The extension should be available in the following browsers:
 *  * Chrome 67 and later
 *  * Chromium-based Edge
 *  * Firefox (with webgl.enable-privileged-extensions set to true in about:config)
 *
 * EXT_disjoint_timer_query only supports one active query per context without nesting. This wrapper keeps an internal stack to make
 * nesting work.
 *
 * The extension API makes timestamps look like a better solution than disjoint timers, but they are not actually supported.
 * See https://bugs.chromium.org/p/chromium/issues/detail?id=595172
 * @internal
 */
export class GLTimer {
  private _extension: DisjointTimerExtension;
  private _queryStack: QueryEntry[];
  private _resultsCallback?: GLTimerResultCallback;

  private constructor(capabilities: Capabilities) {
    this._extension = new DisjointTimerExtension(capabilities);
    this._queryStack = [];
    this._resultsCallback = undefined;
  }

  // This class is necessarily a singleton per context because of the underlying extension it wraps.
  // System is expected to call create in its constructor.
  public static create(capabilities: Capabilities): GLTimer {
    return new GLTimer(capabilities);
  }

  public get isSupported(): boolean { return this._extension.isSupported; }

  public set resultsCallback(callback: GLTimerResultCallback | undefined) {
    if (this._queryStack.length !== 0)
      throw new IModelError(BentleyStatus.ERROR, "Do not set resultsCallback when a frame is already being drawn");

    this._resultsCallback = callback;
  }

  public beginOperation(label: string) {
    if (!this._resultsCallback)
      return;

    this.pushQuery(label);
  }

  public endOperation() {
    if (!this._resultsCallback)
      return;
    if (this._queryStack.length === 0)
      throw new IModelError(BentleyStatus.ERROR, "Mismatched calls to beginOperation/endOperation");

    this.popQuery();
  }

  public beginFrame() {
    if (!this._resultsCallback)
      return;
    if (this._queryStack.length !== 0)
      throw new IModelError(BentleyStatus.ERROR, "Already recording timing for a frame");

    const query = this._extension.createQuery();
    this._extension.beginQuery(query);
    this._queryStack.push({ label: "Total", query, children: [] });
  }

  public endFrame() {
    if (!this._resultsCallback)
      return;
    if (this._queryStack.length !== 1)
      throw new IModelError(BentleyStatus.ERROR, "Missing at least one endOperation call");

    this._extension.endQuery();
    const root = this._queryStack.pop()!;

    const userCallback = this._resultsCallback;
    const extension = this._extension;

    const queryCallback = () => {
      // It takes more one or more frames for results to become available.
      // Only checking time for root since it will always be the last query completed.
      if (!extension.isResultAvailable(root.query)) {
        setTimeout(queryCallback, 0);
        return;
      }

      const processQueryEntry = (queryEntry: QueryEntry): GLTimerResult => {
        const time = extension.getResult(queryEntry.query);
        extension.deleteQuery(queryEntry.query);

        const result: GLTimerResult = { label: queryEntry.label, nanoseconds: time };
        if (queryEntry.children === undefined)
          return result;

        result.children = [];
        for (const child of queryEntry.children) {
          const childResult = processQueryEntry(child);
          result.children.push(childResult);
          result.nanoseconds += childResult.nanoseconds;
        }
        return result;
      };

      userCallback(processQueryEntry(root));
    };
    setTimeout(queryCallback, 0);
  }

  private pushQuery(label: string) {
    this._extension.endQuery();

    const query = this._extension.createQuery();
    this._extension.beginQuery(query);

    const activeQuery = this._queryStack[this._queryStack.length - 1];
    const queryEntry: QueryEntry = { label, query };
    this._queryStack.push(queryEntry);

    if (activeQuery.children === undefined)
      activeQuery.children = [queryEntry];
    else
      activeQuery.children.push(queryEntry);
  }

  private popQuery() {
    this._extension.endQuery();
    this._queryStack.pop();

    const activeQuery = this._queryStack[this._queryStack.length - 1];
    this._extension.beginQuery(activeQuery.query);
  }
}