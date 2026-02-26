#!/bin/bash
ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
