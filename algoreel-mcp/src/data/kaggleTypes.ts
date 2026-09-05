export interface KaggleDatasetRef {
  ownerSlug: string;
  datasetSlug: string;
}

export interface KaggleCredentials {
  username: string;
  key: string;
}

export interface KaggleFile {
  name: string;
  totalBytes?: number;
}
