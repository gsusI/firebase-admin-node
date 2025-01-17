/*!
 * Copyright 2019 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as chai from 'chai';

import * as admin from '../../lib/index';

const expect = chai.expect;

const RULES_FILE_NAME = 'firestore.rules';

const SAMPLE_FIRESTORE_RULES = `service cloud.firestore {
  // Admin Node.js integration test run at ${new Date().toUTCString()}
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

const SAMPLE_STORAGE_RULES = `service firebase.storage {
  // Admin Node.js integration test run at ${new Date().toUTCString()}
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}`;

const RULESET_NAME_PATTERN = /[0-9a-zA-Z-]+/;


describe('admin.securityRules', () => {

  let testRuleset: admin.securityRules.Ruleset = null;
  const rulesetsToDelete: string[] = [];

  function scheduleForDelete(ruleset: admin.securityRules.Ruleset) {
    rulesetsToDelete.push(ruleset.name);
  }

  function unscheduleForDelete(ruleset: admin.securityRules.Ruleset) {
    rulesetsToDelete.splice(rulesetsToDelete.indexOf(ruleset.name), 1);
  }

  function deleteTempRulesets(): Promise<void[]> {
    const promises: Array<Promise<void>> = [];
    rulesetsToDelete.forEach((rs) => {
      promises.push(admin.securityRules().deleteRuleset(rs));
    });
    rulesetsToDelete.splice(0, rulesetsToDelete.length); // Clear out the array.
    return Promise.all(promises);
  }

  after(() => {
    return deleteTempRulesets();
  });

  describe('createRulesFileFromSource()', () => {
    it('creates a RulesFile from the source string', () => {
      const rulesFile = admin.securityRules().createRulesFileFromSource(
        RULES_FILE_NAME, SAMPLE_FIRESTORE_RULES);
      expect(rulesFile.name).to.equal(RULES_FILE_NAME);
      expect(rulesFile.content).to.equal(SAMPLE_FIRESTORE_RULES);
    });

    it('creates a RulesFile from the source Buffer', () => {
      const rulesFile = admin.securityRules().createRulesFileFromSource(
        'firestore.rules', Buffer.from(SAMPLE_FIRESTORE_RULES, 'utf-8'));
      expect(rulesFile.name).to.equal(RULES_FILE_NAME);
      expect(rulesFile.content).to.equal(SAMPLE_FIRESTORE_RULES);
    });
  });

  describe('createRuleset()', () => {
    it('creates a new Ruleset from a given RulesFile', () => {
      const rulesFile = admin.securityRules().createRulesFileFromSource(
        RULES_FILE_NAME, SAMPLE_FIRESTORE_RULES);
      return admin.securityRules().createRuleset(rulesFile)
        .then((ruleset) => {
          testRuleset = ruleset;
          scheduleForDelete(ruleset);
          verifyFirestoreRuleset(ruleset);
        });
    });

    it('rejects with invalid-argument when the source is invalid', () => {
      const rulesFile = admin.securityRules().createRulesFileFromSource(
        RULES_FILE_NAME, 'invalid syntax');
      return admin.securityRules().createRuleset(rulesFile)
        .should.eventually.be.rejected.and.have.property('code', 'security-rules/invalid-argument');
    });
  });

  describe('getRuleset()', () => {
    it('rejects with not-found when the Ruleset does not exist', () => {
      const name = 'e1212' + testRuleset.name.substring(5);
      return admin.securityRules().getRuleset(name)
        .should.eventually.be.rejected.and.have.property('code', 'security-rules/not-found');
    });

    it('rejects with invalid-argument when the Ruleset name is invalid', () => {
      return admin.securityRules().getRuleset('invalid')
        .should.eventually.be.rejected.and.have.property('code', 'security-rules/invalid-argument');
    });

    it('resolves with existing Ruleset', () => {
      return admin.securityRules().getRuleset(testRuleset.name)
        .then((ruleset) => {
          verifyFirestoreRuleset(ruleset);
        });
    });
  });

  describe('Cloud Firestore', () => {
    let oldRuleset: admin.securityRules.Ruleset = null;
    let newRuleset: admin.securityRules.Ruleset = null;

    function revertFirestoreRuleset(): Promise<void> {
      if (!newRuleset) {
        return Promise.resolve();
      }

      return admin.securityRules().releaseFirestoreRuleset(oldRuleset);
    }

    after(() => {
      return revertFirestoreRuleset();
    });

    it('getFirestoreRuleset() returns the Ruleset currently in effect', () => {
      return admin.securityRules().getFirestoreRuleset()
        .then((ruleset) => {
          expect(ruleset.name).to.match(RULESET_NAME_PATTERN);
          const createTime = new Date(ruleset.createTime);
          expect(ruleset.createTime).equals(createTime.toUTCString());

          expect(ruleset.source.length).to.equal(1);
        });
    });

    it('releaseFirestoreRulesetFromSource() applies the specified Ruleset to Firestore', () => {
      return admin.securityRules().getFirestoreRuleset()
        .then((ruleset) => {
          oldRuleset = ruleset;
          return admin.securityRules().releaseFirestoreRulesetFromSource(SAMPLE_FIRESTORE_RULES);
        })
        .then((ruleset) => {
          scheduleForDelete(ruleset);
          newRuleset = ruleset;

          expect(ruleset.name).to.not.equal(oldRuleset.name);
          verifyFirestoreRuleset(ruleset);
          return admin.securityRules().getFirestoreRuleset();
        })
        .then((ruleset) => {
          expect(ruleset.name).to.equal(newRuleset.name);
          verifyFirestoreRuleset(ruleset);
        });
    });
  });

  describe('Cloud Storage', () => {
    let oldRuleset: admin.securityRules.Ruleset = null;
    let newRuleset: admin.securityRules.Ruleset = null;

    function revertStorageRuleset(): Promise<void> {
      if (!newRuleset) {
        return Promise.resolve();
      }

      return admin.securityRules().releaseStorageRuleset(oldRuleset);
    }

    after(() => {
      return revertStorageRuleset();
    });

    it('getStorageRuleset() returns the currently applied Storage rules', () => {
      return admin.securityRules().getStorageRuleset()
        .then((ruleset) => {
          expect(ruleset.name).to.match(RULESET_NAME_PATTERN);
          const createTime = new Date(ruleset.createTime);
          expect(ruleset.createTime).equals(createTime.toUTCString());

          expect(ruleset.source.length).to.equal(1);
        });
    });

    it('releaseStorageRulesetFromSource() applies the specified Ruleset to Storage', () => {
      return admin.securityRules().getStorageRuleset()
        .then((ruleset) => {
          oldRuleset = ruleset;
          return admin.securityRules().releaseStorageRulesetFromSource(SAMPLE_STORAGE_RULES);
        })
        .then((ruleset) => {
          scheduleForDelete(ruleset);
          newRuleset = ruleset;

          expect(ruleset.name).to.not.equal(oldRuleset.name);
          expect(ruleset.name).to.match(RULESET_NAME_PATTERN);
          const createTime = new Date(ruleset.createTime);
          expect(ruleset.createTime).equals(createTime.toUTCString());
          return admin.securityRules().getStorageRuleset();
        })
        .then((ruleset) => {
          expect(ruleset.name).to.equal(newRuleset.name);
        });
    });
  });

  describe('listRulesetMetadata()', () => {
    it('lists all available Rulesets in pages', () => {
      type RulesetMetadata = admin.securityRules.RulesetMetadata;

      function listAllRulesets(
        pageToken?: string, results: RulesetMetadata[] = []): Promise<RulesetMetadata[]> {

        return admin.securityRules().listRulesetMetadata(100, pageToken)
          .then((page) => {
            results.push(...page.rulesets);
            if (page.nextPageToken) {
              return listAllRulesets(page.nextPageToken, results);
            }

            return results;
          });
      }

      return listAllRulesets()
        .then((rulesets) => {
          expect(rulesets.some((rs) => rs.name === testRuleset.name)).to.be.true;
        });
    });

    it('lists the specified number of Rulesets', () => {
      return admin.securityRules().listRulesetMetadata(2)
        .then((page) => {
          expect(page.rulesets.length).to.be.at.most(2);
          expect(page.rulesets.length).to.be.at.least(1);
        });
    });
  });

  describe('deleteRuleset()', () => {
    it('rejects with not-found when the Ruleset does not exist', () => {
      const name = 'e1212' + testRuleset.name.substring(5);
      return admin.securityRules().deleteRuleset(name)
        .should.eventually.be.rejected.and.have.property('code', 'security-rules/not-found');
    });

    it('rejects with invalid-argument when the Ruleset name is invalid', () => {
      return admin.securityRules().deleteRuleset('invalid')
        .should.eventually.be.rejected.and.have.property('code', 'security-rules/invalid-argument');
    });

    it('deletes existing Ruleset', () => {
      return admin.securityRules().deleteRuleset(testRuleset.name)
        .then(() => {
          return admin.securityRules().getRuleset(testRuleset.name)
            .should.eventually.be.rejected.and.have.property('code', 'security-rules/not-found');
        })
        .then(() => {
          unscheduleForDelete(testRuleset); // Already deleted.
          testRuleset = null;
        });
    });
  });

  function verifyFirestoreRuleset(ruleset: admin.securityRules.Ruleset) {
    expect(ruleset.name).to.match(RULESET_NAME_PATTERN);
    const createTime = new Date(ruleset.createTime);
    expect(ruleset.createTime).equals(createTime.toUTCString());

    expect(ruleset.source.length).to.equal(1);
    expect(ruleset.source[0].name).to.equal(RULES_FILE_NAME);
    expect(ruleset.source[0].content).to.equal(SAMPLE_FIRESTORE_RULES);
  }
});
