// Side-effect module: registering tracing as the FIRST import in a service's
// entry file makes the OTel auto-instrumentation patches apply before amqplib
// (or any other instrumented library) is loaded by subsequent imports.
//
// Usage in a service entry (must be the FIRST import):
//   import { nodeTracerProvider } from '@diia-inhouse/diia-app/tracing/register'
//   import { bootstrap } from './bootstrap.js'
//   void bootstrap(serviceName, nodeTracerProvider)

import { initTracing } from './index.js'

export const nodeTracerProvider = initTracing()
