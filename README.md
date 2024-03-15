# Diia

This repository provides an overview over the flagship product [**Diia**](https://diia.gov.ua/) developed by the [**Ministry of Digital Transformation of Ukraine**](https://thedigital.gov.ua/).

**Diia** is an app with access to citizen’s digital documents and government services.

The application was created so that Ukrainians could interact with the state in a few clicks, without spending their time on queues and paperwork - **Diia** open source application will help countries, companies and communities build a foundation for long-term relationships. At the heart of these relations are openness, efficiency and humanity.

We're pleased to share the **Diia** project with you.

## Useful Links

| Topic                                         | Link                       | Description                                                                |
| --------------------------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| Ministry of Digital Transformation of Ukraine | https://thedigital.gov.ua/ | The Official homepage of the Ministry of Digital Transformation of Ukraine |
| Diia App                                      | https://diia.gov.ua/       | The Official website for the Diia application                              |

## Getting Started

This repository contains the package which provides service bootstrap functionality with all required dependencies.

## Build Process

### **1. Clone codebase via `git clone` command**

Example:

```
git clone https://github.com/diia-open-source/be-diia-app.git diia-app
```

---

### **2. Go to code base root directory**

```
cd ./diia-app
```

---

### **3. Install npm dependencies**

The installation of dependencies consists of the following 2 steps:

#### **1. Manually clone, build and link dependencies from `@diia-inhouse` scope**

Each Diia service depends on dependencies from `@diia-inhouse/<package>` scope which are distributed across different repositories, are built separately, and aren't published into public npm registry.

The full list of such dependencies can be found in the target service `package.json` file in `dependencies` and `devDependencies` sections respectively.

Detailed instructions on how to link dependencies from `@diia-inhouse/<package>` scope are described in `LINKDEPS.md` which can be found here
https://github.com/diia-open-source/diia-setup-howto/tree/main/backend

#### **2. Install public npm dependencies and use those linked from `@diia-inhouse` scope**

In order to install and use the linked dependencies for `diia-app` the following command can be used:

```
$ cd ./diia-app
$ npm link @diia-inhouse/db @diia-inhouse/redis ... @diia-inhouse/<package-name>
```

In case all dependencies from `@diia-inhouse` scope are linked, and can be resolved, you will then have a complete list of dependencies installed for the service code base.

---

### **4. Build package**

In order to build the service you have to run the command `npm run build` inside the root directory of service code base as per:

```
$ cd ./diia-app
$ npm run build
```

---

## How to contribute

The Diia project welcomes contributions into this solution; please refer to the CONTRIBUTING.md file for details

## Licensing

Copyright (C) Diia and all other contributors.

Licensed under the **EUPL** (the "License"); you may not use this file except in compliance with the License. Re-use is permitted, although not encouraged, under the EUPL, with the exception of source files that contain a different license.

You may obtain a copy of the License at [https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12](https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12).

Questions regarding the Diia project, the License and any re-use should be directed to [modt.opensource@thedigital.gov.ua](mailto:modt.opensource@thedigital.gov.ua).

This project incorporates third party material. In all cases the original copyright notices and the license under which these third party dependencies were provided remains as so. In relation to the Typescript dependency you should also review the [Typescript Third Party Notices](
https://github.com/microsoft/TypeScript/blob/9684ba6b0d73c37546ada901e5d0a5324de7fc1d/ThirdPartyNoticeText.txt).
