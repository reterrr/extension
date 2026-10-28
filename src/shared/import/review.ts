    const metadata = Object.fromEntries(
      [...physicalMetadataFields]
        .filter((field) => Object.prototype.hasOwnProperty.call(file, field))
        .map((field) => [
          field,
          (file as unknown as Record<string, unknown>)[field],
        ]),
    );
    Object.assign(
      metadata,
      linkedDocument ? requirementMetadata(linkedDocument) : {},
    );

    const fileEvidence = portableTargetEvidence(
      session.previewState,
      object.id,
      { kind: "file_source", id: String(file.id) },
      sourceById,
    );
    const rawEvidence = mergePortableEvidence(
      fileEvidence,
      linkedDocument ? mappedDocumentEvidence(linkedDocument) : undefined,
    );
    const evidence = rawEvidence
      ? Object.fromEntries(Object.entries(rawEvidence).filter(
          ([field]) => physicalMetadataFields.has(field) && field in metadata,
        ))
      : undefined;

    return {
      key: fileKeyById.get(file.id),
      source: source.importKey,
      ...(pageSource ? { source_page: pageSource.importKey } : {}),
      ...(Object.keys(metadata).length ? { metadata } : {}),
      ...(evidence ? { evidence } : {}),
    };
  });

  for (const row of unlinkedDocuments) {
    const key = uniqueFileKey(
      String(row.importKey ?? `DOC_${portableFiles.length + 1}`),
    );
    const metadata = requirementMetadata(row, true);
    const rawEvidence = mappedDocumentEvidence(row);
    const evidence = rawEvidence
      ? Object.fromEntries(Object.entries(rawEvidence).filter(
          ([field]) => field in metadata,
        ))
      : undefined;
    portableFiles.push({
      key,
      without_template: true,
      metadata,
      ...(evidence ? { evidence } : {}),
    });
  }

  const sources = [...usedSourceIds].map((sourceId) => {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error(`Missing import source ${sourceId}.`);
    return {
      key: source.importKey,
      type: source.type,
      ...(source.url ? { url: source.url } : {}),
      snapshot: {
        text: source.snapshot.text,
        ...(source.snapshot.capturedAt ? { captured_at: source.snapshot.capturedAt } : {}),
        ...(source.snapshot.contentHash ? { content_hash: source.snapshot.contentHash } : {}),
        ...(source.snapshot.parserVersion ? { parser_version: source.snapshot.parserVersion } : {}),
      },
    };
  });

  const portableOperators = operatorAssignments.map((assignment) => {
    const target = session.previewState.objects.find(
      (entry) => entry.id === assignment.operatorId && entry.type === "operator",
    );
    if (!target?.importKey) {
      throw new Error("Could not resolve imported operator assignment.");
    }
    return {
      key: String(assignment.importKey ?? assignment.id),
      operator: { $ref: target.importKey },
      operator_type: assignment.operatorType,
    };
  });

  const portableGeography = (session.previewState.geographies ?? [])
    .filter((row) => row.objectId === object.id)
    .map((row) => {
      const operator = row.operatorId
        ? session.previewState.objects.find(
            (entry) => entry.id === row.operatorId && entry.type === "operator",
          )
        : undefined;
      return {
      key: String(row.importKey ?? row.id),
      type: String(row.type),
      role: String(row.role),
      value: String(row.value),
      ...(operator?.importKey ? { operator: { $ref: operator.importKey } } : {}),
      ...(portableTargetEvidence(
        session.previewState,
        object.id,
        { kind: "geography", id: String(row.id) },
        sourceById,
      )
        ? {
            evidence: portableTargetEvidence(
              session.previewState,
              object.id,
              { kind: "geography", id: String(row.id) },
              sourceById,
            ),
          }
        : {}),
    };
    });

  const portableContacts = (session.previewState.operatorContacts ?? [])
    .filter((row) => row.objectId === object.id)
    .map((row) => ({
      key: String(row.importKey ?? row.id),
      kind: String(row.kind),
      value: String(row.value),
      ...(portableTargetEvidence(
        session.previewState,
        object.id,
        { kind: "operator_contact", id: String(row.id) },
        sourceById,
      )
        ? {
            evidence: portableTargetEvidence(
              session.previewState,
              object.id,
              { kind: "operator_contact", id: String(row.id) },
              sourceById,
            ),
          }
        : {}),
    }));

  const serviceProject =
    object.type === "project"
      ? object
      : object.type === "recruitment"
        ? session.previewState.objects.find(
            (entry) =>
              entry.type === "project" &&
              entry.id === object.values?.project_id,
          )
        : undefined;
  const projectServices = (session.previewState.serviceCategories ?? []).filter(
    (row) => row.objectId === serviceProject?.id,
  );
  const serviceKeyById = new Map(
    projectServices.map((row) => [
      row.id,
      String(row.importKey ?? row.id),
    ]),
  );
  const portableServices =
    object.type === "project"
      ? projectServices.map((row) => ({
          key: String(row.importKey ?? row.id),
          label: row.label,
        }))
      : [];

  const selectedFinancing = (session.previewState.financingRules ?? []).filter(
    (row) => row.objectId === object.id,
  );
  const financingFieldsByImportKey: Record<string, string[]> = {};
  const portableFinancing = selectedFinancing.map((row) => {
    const key = String(row.importKey ?? row.id);
    const selectedFields = explicitFinancingFields(
      session,
      object.id,
      row,
      key,
    );
    financingFieldsByImportKey[key] = selectedFields;

    const data: Record<string, unknown> = {};
    for (const field of selectedFields) {
      if (Object.prototype.hasOwnProperty.call(row, field)) data[field] = row[field];
    }
    const evidence = portableTargetEvidence(
      session.previewState,
      object.id,
      { kind: "funding", id: String(row.id) },
      sourceById,
    );
    const serviceKey = row.service_category_id
      ? serviceKeyById.get(String(row.service_category_id))
      : undefined;
    return {
      key,
      company_size: String(row.company_size),
      ...(serviceKey ? { service: serviceKey } : {}),
      data,
      ...(evidence ? { evidence } : {}),
    };
  });

  const dependencyMap = new Map<string, LegacyStoredObject>();
  for (const { target } of references) {
    if (target.importKey) dependencyMap.set(target.importKey, target);
  }
  for (const target of operatorDependencies) {
    if (target.importKey) dependencyMap.set(target.importKey, target);
  }

  return {
    selectedImportKey: object.importKey,
    ...(existingTarget ? { existingTargetObjectId: existingTarget.id } : {}),
    selectedDataFields: explicitObjectFields(session, object),
    financingFieldsByImportKey,
    referencePatches,
    operatorReferencePatches,
    existingReferenceLinks,
    temporaryDependencyImportKeys: [...dependencyMap.keys()],
    document: {
      version: 1,
      offset_unit: "unicode_codepoint",
      sources,
      objects: [
        ...[...dependencyMap.values()].map((dependency) => {
          const stub = dependencyStub(dependency);
          if (dependency.type !== "project") return stub;
          const services = (session.previewState.serviceCategories ?? [])
            .filter((row) => row.objectId === dependency.id)
            .map((row) => ({
              key: String(row.importKey ?? row.id),
              label: row.label,
            }));
          return services.length ? { ...stub, services } : stub;
        }),
        {
          key: object.importKey,
          type: object.type,
          ...(object.sourceUrl ? { source_url: object.sourceUrl } : {}),
          data: portableData(session, object),
          ...(object.evidence
            ? { evidence: portableEvidence(object, sourceById) }
            : {}),
          ...(portableOperators.length ? { operators: portableOperators } : {}),
          ...(portableFiles.length ? { files: portableFiles } : {}),
          ...(portableGeography.length
            ? { geography: portableGeography }
            : {}),
          ...(portableContacts.length ? { contacts: portableContacts } : {}),
          ...(portableServices.length ? { services: portableServices } : {}),
          ...(portableFinancing.length
            ? { financing: portableFinancing }
            : {}),
        },
      ],
    },
  };
}

export function markImportObjectLinked(
  session: ImportReviewSession,
  importKey: string,
  targetObjectId: string,
  now: string,
): void {
  const object = session.previewState.objects.find(
    (entry) => entry.importKey === importKey,
  );
  if (!object) return;
  session.statusByObjectId[object.id] = "APPROVED";
  session.approvedObjectIdByImportKey[importKey] = targetObjectId;
  session.updatedAt = now;
}

export function markImportObjectApproved(
  session: ImportReviewSession,
  previewObjectId: string,
  stagedObjectId: string,
  now: string,
): void {
  const object = session.previewState.objects.find((entry) => entry.id === previewObjectId);
  if (!object?.importKey) throw new Error("Imported object not found.");
  session.statusByObjectId[previewObjectId] = "APPROVED";
  session.approvedObjectIdByImportKey[object.importKey] = stagedObjectId;
  session.updatedAt = now;
  session.selectedObjectId =
    session.objectOrder.find(
      (id) => (session.statusByObjectId[id] ?? "PENDING") === "PENDING",
    ) ?? previewObjectId;
}


export function revokeApprovedImportObject(
  session: ImportReviewSession,
  previewObjectId: string,
  now: string,
): void {
  const object = session.previewState.objects.find(
    (entry) => entry.id === previewObjectId,
  );
  if (!object?.importKey) throw new Error("Imported object not found.");
  if (session.statusByObjectId[previewObjectId] !== "APPROVED") {
    throw new Error("Ten obiekt nie został jeszcze dodany do View.");
  }

  session.statusByObjectId[previewObjectId] = "REJECTED";
  delete session.approvedObjectIdByImportKey[object.importKey];
  session.updatedAt = now;
  session.selectedObjectId = previewObjectId;
}

export function markImportObjectRejected(
  session: ImportReviewSession,
  previewObjectId: string,
  now: string,
): void {
  const object = session.previewState.objects.find(
    (entry) => entry.id === previewObjectId,
  );
  if (!object) throw new Error("Imported object not found.");
  if (session.statusByObjectId[previewObjectId] === "APPROVED") {
    throw new Error("Obiekt jest już w View. Odrzuć jego zmiany z View, jeśli chcesz je wycofać.");
  }
  session.statusByObjectId[previewObjectId] = "REJECTED";
  session.updatedAt = now;
  session.selectedObjectId =
    session.objectOrder.find(
      (id) => session.statusByObjectId[id] === "PENDING",
    ) ?? previewObjectId;
}

export function restoreRejectedImportObject(
  session: ImportReviewSession,
  previewObjectId: string,
  now: string,
): void {
  if (session.statusByObjectId[previewObjectId] !== "REJECTED") return;
  session.statusByObjectId[previewObjectId] = "PENDING";
  session.updatedAt = now;
  session.selectedObjectId = previewObjectId;
}
