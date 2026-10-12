// SPDX-License-Identifier: GPL-3.0-or-later
import * as Comlink from 'comlink';
import { prepareMachineImport } from '@/io/machine/import';
Comlink.expose({ prepareMachineImport });
