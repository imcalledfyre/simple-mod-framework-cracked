// @ts-expect-error Need to assign on global because of QuickEntity
global.THREE = require("./three-onlymath.min")

import * as Sentry from "@sentry/node"
import * as Tracing from "@sentry/tracing"
import * as LosslessJSON from "lossless-json"

import { DateTime, Duration, DurationLikeObject } from "luxon"
import type { Span, Transaction } from "@sentry/tracing"

import { Platform } from "./types"
import core from "./core-singleton"
import deploy from "./deploy"
import difference from "./difference"
import discover from "./discover"
import fs from "fs-extra"
import md5File from "md5-file"
import path from "path"
import { xxhash3 } from "hash-wasm"

require("clarify")

const gameHashes = {
	"bf93b21877ca6b94b99af14832497028": Platform.epic, // base game
	"39f48db74dbee602942c13af061f62e0": Platform.epic, // ansel unlock
	//"09278760d4943ad21d04921169366d54": Platform.epic, // ansel no collision
	//"a8752bc4b36a74600549778685db3b4c": Platform.epic, // ansel unlock + no collision
	"09d6139753bc619570860707dc8a05d4": Platform.steam, // base game
	"f435b7d6be29b772d7193f507cb4dab1": Platform.steam, // ansel unlock
	//"28607baf7a75271b6924fe0d52263600": Platform.steam, // ansel no collision
	//"d028074b654cb628ef88ced7b5d3eb96": Platform.steam, // ansel unlock + no collision

	// Gamepass/store protects the EXE from reading so we can't hash it, instead we hash the game config
	"46c8230da02f8194fc8b1ee20b61d3af": Platform.microsoft
} as {
	[k: string]: Platform
}

if (!core.config.reportErrors) {
	process.on("uncaughtException", (err, origin) => {
		void (async () => {
			if (!core.args["--useConsoleLogging"]) {
				await core.logger.warn("Error reporting is disabled; if you experience this issue again, please enable it so that the problem can be debugged.")
			}

			await core.logger.error(`Uncaught exception! ${err}`, false)
			console.error(origin)
			await core.cleanExit()
		})()
	})

	process.on("unhandledRejection", (err, origin) => {
		void (async () => {
			if (!core.args["--useConsoleLogging"]) {
				await core.logger.warn("Error reporting is disabled; if you experience this issue again, please enable it so that the problem can be debugged.")
			}

			await core.logger.error(`Unhandled promise rejection! ${err}`, false)
			console.error(origin)
			await core.cleanExit()
		})()
	})
}

if (!fs.existsSync(core.config.runtimePath)) {
	void core.logger.error("The Runtime folder couldn't be located, please re-read the installation instructions!")
}

if (!(fs.existsSync(path.join(core.config.retailPath, "Runtime", "chunk0.rpkg")) || fs.existsSync(path.join(core.config.runtimePath, "..", "Retail", "HITMAN3.exe")))) {
	void core.logger.error("HITMAN3.exe couldn't be located, please re-read the installation instructions!")
}

if (fs.existsSync(path.join(core.config.retailPath, "Runtime", "chunk0.rpkg")) && !fs.existsSync(path.join(core.config.retailPath, "..", "MicrosoftGame.Config"))) {
	void core.logger.error("The game config couldn't be located, please re-read the installation instructions!")
}

if (fs.existsSync(path.join(core.config.retailPath, "Runtime", "chunk0.rpkg"))) {
	try {
		fs.accessSync(path.join(core.config.retailPath, "thumbs.dat"), fs.constants.R_OK | fs.constants.W_OK)
	} catch {
		void core.logger.error("thumbs.dat couldn't be accessed; try running Mod Manager.exe in the similarly named folder as administrator!")
	}
}

core.config.platform = fs.existsSync(path.join(core.config.retailPath, "Runtime", "chunk0.rpkg"))
	? gameHashes[md5File.sync(path.join(core.config.retailPath, "..", "MicrosoftGame.Config"))]
	: gameHashes[md5File.sync(path.join(core.config.runtimePath, "..", "Retail", "HITMAN3.exe"))] // Platform detection

let sentryTransaction = {
	startChild(...args) {
		return {
			startChild(...args) {
				return {
					startChild(...args) {
						return {
							startChild(...args) {
								return {
									startChild(...args) {
										return {
											startChild(...args) {
												return {
													startChild(...args) {
														return {
															finish(...args) {}
														}
													},
													finish(...args) {}
												}
											},
											finish(...args) {}
										}
									},
									finish(...args) {}
								}
							},
							finish(...args) {}
						}
					},
					finish(...args) {}
				}
			},
			finish(...args) {}
		}
	},
	finish(...args) {}
} as Transaction

function configureSentryScope(transaction: Span) {
	if (core.config.reportErrors)
		Sentry.configureScope((scope) => {
			scope.setSpan(transaction)
		})
}

function toHuman(dur: Duration) {
	const units: (keyof DurationLikeObject)[] = ["years", "months", "days", "hours", "minutes", "seconds", "milliseconds"]
	const smallestIdx = units.indexOf("seconds")
	const entries = Object.entries(
		dur
			.shiftTo(...units)
			.normalize()
			.toObject()
	).filter(([_, amount], idx) => amount > 0 && idx <= smallestIdx)
	return entries.map((a) => a[1] + a[0][0]).join("")
}

process.on("SIGINT", () => void core.logger.error("Received SIGINT signal"))
process.on("SIGTERM", () => void core.logger.error("Received SIGTERM signal"))

async function doTheThing() {
    const startedDate = Date.now();

    try {
        await core.logger.info("Initialising mod deployment");

        // Make sure runtime and staging folders exist
        fs.ensureDirSync(core.config.runtimePath);
        fs.ensureDirSync(path.join(process.cwd(), "staging"));
        fs.ensureDirSync(path.join(process.cwd(), "temp"));
        fs.ensureDirSync(path.join(process.cwd(), "cache"));

        await core.logger.verbose("Initialising RPKG instance");
        await core.rpkgInstance.waitForInitialised();

        // Clear old patch files in safe range
        for (const chunkPatchFile of fs.readdirSync(core.config.runtimePath)) {
            try {
                if (chunkPatchFile.includes("patch")) {
                    const matches = [...chunkPatchFile.matchAll(/chunk[0-9]*patch([0-9]*)\.rpkg/g)];
                    const patchNum = parseInt(matches[matches.length - 1][1]);
                    if (patchNum >= 200 && patchNum <= 300) {
                        fs.rmSync(path.join(core.config.runtimePath, chunkPatchFile));
                    }
                } else if (chunkPatchFile.match(/chunk[0-9]+/) && parseInt(chunkPatchFile.split(".")[0].slice(5)) > 30) {
                    fs.rmSync(path.join(core.config.runtimePath, chunkPatchFile));
                }
            } catch {}
        }

        await core.logger.verbose("Discovering mod contents");
        const fileMap = await discover();

        await core.logger.verbose("Checking cache versions");
        const cachePath = path.join(process.cwd(), "cache", "map.json");
        let cachedFiles = {};
        if (fs.existsSync(cachePath)) {
            const cacheData = fs.readJSONSync(cachePath);
            if (cacheData.frameworkVersion < core.FrameworkVersion) fs.emptyDirSync(path.join(process.cwd(), "cache"));
            else cachedFiles = cacheData.files;
        }

        await core.logger.verbose("Calculating differences");
        const { invalidData } = await difference(cachedFiles, fileMap);

        await core.logger.verbose("Writing updated cache");
        fs.writeJSONSync(cachePath, {
            files: fileMap,
            frameworkVersion: core.FrameworkVersion,
            game: fs.existsSync(path.join(core.config.retailPath, "Runtime", "chunk0.rpkg"))
                ? md5File.sync(path.join(core.config.retailPath, "..", "MicrosoftGame.Config"))
                : md5File.sync(path.join(core.config.runtimePath, "..", "Retail", "HITMAN3.exe")),
        });

        await core.logger.verbose("Deploying mods");
        await deploy(null, () => {}, invalidData); // no sentry transaction needed

        await core.logger.info(`Deployment done in ${((Date.now() - startedDate) / 1000).toFixed(2)}s`);
    } catch (err) {
        await core.logger.error("Error during mod deployment: " + err, false);
    }

    await core.cleanExit();
}
void doTheThing()
