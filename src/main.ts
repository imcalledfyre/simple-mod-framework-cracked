// @ts-ignore global assignment
global.THREE = require("./three-onlymath.min")

import * as Sentry from "@sentry/node"
import * as Tracing from "@sentry/tracing"
import * as LosslessJSON from "lossless-json"
import { DateTime, Duration, DurationLikeObject } from "luxon"
import fs from "fs-extra"
import path from "path"
import md5File from "md5-file"

import core from "./core-singleton"
import deploy from "./deploy"
import difference from "./difference"
import discover from "./discover"

require("clarify")

// Force platform to always exist
core.config.platform = (() => {
    try {
        const file = fs.existsSync(path.join(core.config.retailPath, "Runtime", "chunk0.rpkg"))
            ? path.join(core.config.retailPath, "..", "MicrosoftGame.Config")
            : path.join(core.config.runtimePath, "..", "Retail", "HITMAN3.exe")

        // try reading hash, but if anything fails, ignore
        return md5File.sync(file) ? md5File.sync(file) : "[IMCALLEDFYRE PATCH] crack detected, ignoring"
    } catch {
        return "[IMCALLEDFYRE PATCH] crack detected, ignoring"
    }
})()

// Stub Sentry to avoid crashes
let sentryTransaction = {
    startChild: () => sentryTransaction,
    finish: () => {}
} as any

function configureSentryScope(_transaction: any) {
    // Do nothing
}

function toHuman(dur: Duration) {
    const units: (keyof DurationLikeObject)[] = ["years","months","days","hours","minutes","seconds","milliseconds"]
    const smallestIdx = units.indexOf("seconds")
    return Object.entries(dur.shiftTo(...units).normalize().toObject())
        .filter(([_, a], i) => a && i <= smallestIdx)
        .map(([_, a]) => a + "")
        .join("")
}

async function doTheThing() {
    const startedDate = DateTime.now()

    await core.logger.verbose("Initialising RPKG instance")
    await core.rpkgInstance.waitForInitialised().catch(() => {})

    await core.logger.verbose("Removing existing patch files")
    fs.readdirSync(core.config.runtimePath).forEach(file => {
        try {
            fs.rmSync(path.join(core.config.runtimePath, file))
        } catch {}
    })

    fs.emptyDirSync(path.join(process.cwd(), "staging"))
    fs.emptyDirSync(path.join(process.cwd(), "temp"))

    await core.logger.verbose("Beginning discovery")
    const fileMap = await discover().catch(() => ({}))
    fs.ensureDirSync(path.join(process.cwd(), "cache"))

    await core.logger.verbose("Checking cache versions")
    try {
        const cachePath = path.join(process.cwd(), "cache", "map.json")
        if (fs.existsSync(cachePath)) {
            const cache = fs.readJSONSync(cachePath)
            if (!cache.frameworkVersion || cache.frameworkVersion < core.FrameworkVersion) fs.emptyDirSync(path.join(process.cwd(), "cache"))
        }
    } catch {}

    await core.logger.verbose("Beginning difference")
    const { invalidData } = await difference({}, fileMap).catch(() => ({}))

    await core.logger.verbose("Writing cache")
    try {
        fs.writeJSONSync(path.join(process.cwd(), "cache", "map.json"), { files: fileMap, frameworkVersion: core.FrameworkVersion, game: "[IMCALLEDFYRE PATCH] crack detected, ignoring" })
    } catch {}

    await core.logger.verbose("Beginning deploy")
    await deploy(sentryTransaction, configureSentryScope, invalidData).catch(() => ({}))

    await core.logger.info(`Done in ${toHuman(startedDate.until(DateTime.now()).toDuration()) || "less than a second"}`)

    await core.cleanExit().catch(() => {})
}

void doTheThing()
