(function () {
  const VARIANT_WORDS = new Set([
    "adjustable", "brass", "steel", "plastic", "black", "white", "large", "small",
    "heavy", "duty", "pack", "set", "kit", "with", "for", "and", "the", "a", "an"
  ]);

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(value) {
    const tokens = normalizeText(value).split(" ").filter(Boolean);
    return tokens.filter(token => token.length > 1 && !VARIANT_WORDS.has(token));
  }

  function uniqueTokens(values) {
    return new Set((values || []).flatMap(value => tokenize(value)));
  }

  function jaccard(left, right) {
    if (!left.size && !right.size) return 0;

    let intersection = 0;
    for (const token of left) {
      if (right.has(token)) intersection += 1;
    }

    const union = new Set([...left, ...right]).size;
    return union ? intersection / union : 0;
  }

  function sameAsin(candidate, storeProduct) {
    return Boolean(candidate.asin && storeProduct.asin && candidate.asin === storeProduct.asin);
  }

  function sameParentAsin(candidate, storeProduct) {
    return Boolean(
      candidate.parent_asin &&
      storeProduct.parent_asin &&
      candidate.parent_asin === storeProduct.parent_asin
    );
  }

  function sameProductType(candidate, storeProduct) {
    const genericTypes = new Set(["hook", "cover", "connector", "hose", "valve", "filter", "bracket"]);
    const candidateType = normalizeText(candidate.product_type).replace(/\s+/g, "_");
    const storeType = normalizeText(storeProduct.product_type).replace(/\s+/g, "_");
    if (!candidateType || !storeType) return false;
    if (candidateType === storeType) return true;
    const candidateTokenCount = candidateType.split("_").filter(Boolean).length;
    const storeTokenCount = storeType.split("_").filter(Boolean).length;
    const shorterType = candidateTokenCount <= storeTokenCount ? candidateType : storeType;
    const shorterTokenCount = Math.min(candidateTokenCount, storeTokenCount);
    if (
      shorterTokenCount >= 2 &&
      !genericTypes.has(shorterType) &&
      (candidateType.endsWith(storeType) || storeType.endsWith(candidateType))
    ) {
      return true;
    }

    const candidateTokens = new Set(candidateType.split("_").filter(token => token.length > 2));
    const storeTokens = new Set(storeType.split("_").filter(token => token.length > 2));
    return jaccard(candidateTokens, storeTokens) >= 0.67;
  }

  function similarityProfile(candidate, storeProduct) {
    const candidateTitle = uniqueTokens([candidate.title, candidate.display_title]);
    const storeTitle = uniqueTokens([storeProduct.title, storeProduct.title_cn, storeProduct.amazon_title]);
    const candidateKeywords = uniqueTokens(candidate.keywords || []);
    const storeKeywords = uniqueTokens(storeProduct.keywords || []);
    const titleSimilarity = jaccard(candidateTitle, storeTitle);
    const keywordSimilarity = jaccard(candidateKeywords, storeKeywords);

    return {
      titleSimilarity,
      keywordSimilarity,
      combinedSimilarity: (titleSimilarity * 0.55) + (keywordSimilarity * 0.45)
    };
  }

  function isHighlySimilar(candidate, storeProduct) {
    const profile = similarityProfile(candidate, storeProduct);
    return (
      (profile.titleSimilarity >= 0.55 && profile.keywordSimilarity >= 0.45) ||
      profile.combinedSimilarity >= 0.62
    );
  }

  function duplicateReason(candidate, storeProduct) {
    if (sameAsin(candidate, storeProduct)) return "same_asin";
    if (sameParentAsin(candidate, storeProduct)) return "same_parent_asin";
    if (sameProductType(candidate, storeProduct)) return "same_product_type";
    if (isHighlySimilar(candidate, storeProduct)) return "high_title_keyword_similarity";
    return "";
  }

  function findDuplicate(candidate, storeProducts) {
    for (const storeProduct of storeProducts || []) {
      const reason = duplicateReason(candidate, storeProduct);
      if (reason) {
        return { isDuplicate: true, reason, storeProduct };
      }
    }

    return { isDuplicate: false, reason: "", storeProduct: null };
  }

  function filterDuplicates(candidates, storeProducts) {
    const kept = [];
    const excluded = [];

    for (const candidate of candidates || []) {
      const duplicate = findDuplicate(candidate, storeProducts);
      if (duplicate.isDuplicate) {
        excluded.push({
          asin: candidate.asin,
          title: candidate.title,
          reason: duplicate.reason,
          matched_asin: duplicate.storeProduct.asin,
          matched_title: duplicate.storeProduct.title || duplicate.storeProduct.title_cn || duplicate.storeProduct.amazon_title || ""
        });
      } else {
        kept.push(candidate);
      }
    }

    return { kept, excluded };
  }

  window.DuplicateFilter = {
    filterDuplicates,
    findDuplicate,
    similarityProfile
  };
})();
