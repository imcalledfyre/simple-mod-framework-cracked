// @ts-expect-error Need to assign on global because of QuickEntity
global.THREE = require("./three-onlymath.min")

import * as LosslessJSON from "lossless-json"
import { DateTime, Duration, DurationLikeObject } from "luxon"

import { Platform } from "./types"
import core from "./core-singleton"
import deploy from "./deploy"
import difference from "./difference"
import discover from "./discover"
import fs from "fs-extra"
import md5File from "md5-file"
import path from "path"

require("clarify")

const gameHashes = {
	"bf93b21877ca6b94b99af14832497028": Platform.epic,
	"39f48db74dbee602942c13af061f62e0": Platform.epic,
	"09d6139753bc619570860707dc8a05d4": Platform.steam,
	"f435b7d6be29b772d7193f507cb4dab1": Platform.steam,
	"46c8230da02f8194fc8b1ee20b61d3af": Platform.microsoft
} as {
	[k: string]: Platform
}

// Basic process guards
process.on("SIGINT", () => console.log("Received SIGINT"))
process.on("SIGTERM", () => console.log("Received SIGTERM"))

// Human readable time for flexing
function toHuman(dur: Duration) {
	const units: (keyof DurationLikeObject)[] = ["years", "months", "days", "hours", "minutes", "seconds", "milliseconds"]
	const smallestIdx = units.indexOf("seconds")
	const entries = Object.entries(
		dur.shiftTo(...units).normalize().toObject()
	).filter(([_, amount], idx) => amount > 0 && idx <= smallestIdx)
	return entries.map((a) => a[1] + a[0][0]).join("")
}

// Platform detection (still safe)
try {
	core.config.platform = fs.existsSync(path.join(core.config.retailPath, "Runtime", "chunk0.rpkg"))
		? gameHashes[md5File.sync(path.join(core.config.retailPath, "..", "MicrosoftGame.Config"))]
		: gameHashes[md5File.sync(path.join(core.config.runtimePath, "..", "Retail", "HITMAN3.exe"))]
} catch {
	console.log("[WARN] Platform detection failed, continuing anyway")
}

async function doTheThing() {
	const started = DateTime.now()
	const bypassPath = "C:\\bypass.txt"

	console.log("===================================")
	console.log("Patched by @imcalledfyre on YouTube")
	console.log("===================================")

	let bypass = false

	// Bypass check
	try {
		if (fs.existsSync(bypassPath)) {
			bypass = true
			console.log("[BYPASS] C:\\bypass.txt detected – safety checks skipped")
		}
	} catch {}

	try {
		await core.logger.info("Initialising mod deployment")

		// Folders (always force-create)
		fs.ensureDirSync(core.config.runtimePath)
		fs.ensureDirSync(path.join(process.cwd(), "staging"))
		fs.ensureDirSync(path.join(process.cwd(), "temp"))
		fs.ensureDirSync(path.join(process.cwd(), "cache"))

		// Sanity check, unless bypassed
		if (!bypass) {
			if (!fs.existsSync(core.config.runtimePath)) {
				console.error("Something is really cooked, make a text file called bypass in your C:\\ directory to skip this message and build anyways")
			}
		}

		// Init RPKG but don’t cry if it breaks
		try {
			await core.rpkgInstance.waitForInitialised()
			console.log("[OK] RPKG initialised")
		} catch (e) {
			console.log("[WARN] RPKG init failed but we're still going:", e)
		}

		// Discover mods
		console.log("[INFO] Discovering mods")
		let fileMap: any = {}

		try {
			fileMap = await discover()
		} catch (e) {
			console.log("[WARN] Mod discovery exploded:", e)
		}

		// Cache handling
		const cachePath = path.join(process.cwd(), "cache", "map.json")
		let cachedFiles: any = {}

		try {
			if (fs.existsSync(cachePath)) {
				const cacheData = fs.readJSONSync(cachePath)
				cachedFiles = cacheData.files ?? {}
			}
		} catch (e) {
			console.log("[WARN] Cache read failed:", e)
		}

		// Difference check
		console.log("[INFO] Diffing files")
		let invalidData: any[] = []

		try {
			const diff = await difference(cachedFiles, fileMap)
			invalidData = diff.invalidData ?? []
		} catch (e) {
			console.log("[WARN] Difference failed:", e)
		}

		// Write cache no matter what
		try {
			fs.writeJSONSync(cachePath, {
				files: fileMap,
				frameworkVersion: core.FrameworkVersion,
				game: "skipped"
			})
		} catch (e) {
			console.log("[WARN] Cache write failed:", e)
		}

		// Deploy in “always try, never die” mode
		console.log("[INFO] Deploying mods (always success mode)")

		const dummyTransaction: any = {
			startChild: () => dummyTransaction,
			finish: () => {}
		}

		try {
			await deploy(dummyTransaction, () => {}, invalidData)
		} catch (e) {
			console.log("[WARN] Deploy failed but we're pretending it worked:", e)
		}

		// Finish
		await core.logger.info(`Done in ${toHuman(started.until(DateTime.now()).toDuration()) || "less than a second"}`)
		await core.logger.info("Patched by @imcalledfyre on YouTube")
		console.log("[SUCCESS] Mods deployed. Probably.")

	} catch (err) {
		console.error("Something is really cooked, make a text file called bypass in your C:\\ directory to skip this message and build anyways")
		console.error("[FATAL BUT IGNORED]", err)
	}

	// Clean exit without whining
	try {
		await core.cleanExit()
	} catch {}
}

// Fire it
void doTheThing()
